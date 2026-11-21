// Cloudflare Worker in front of the route service. The default entrypoint (never cached) normalises the URL and
// sends cacheable GETs to the Cached entrypoint, which Workers Cache serves without running code on a hit; only a
// miss runs Cached, applies the rate limits and wakes the container.
import { WorkerEntrypoint } from 'cloudflare:workers';
import { Container, getContainer } from '@cloudflare/containers';

const MAX_INFLIGHT = 6; // requests queued at the container at once; more get 503 straight away

export class InterwayService extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = '15m';
  private inflight = 0;

  override async fetch(request: Request): Promise<Response> {
    if (this.inflight >= MAX_INFLIGHT) return busy('The route service is busy');
    this.inflight++;
    try {
      // the service listens only once its data is loaded (about 20 s): wait longer than the library's 20 s default
      if ((await this.getState()).status !== 'healthy') {
        await this.startAndWaitForPorts({ ports: this.defaultPort, cancellationOptions: { portReadyTimeoutMS: 90_000, abort: request.signal } });
      }
      const res = await super.fetch(request);
      // container/start failures carry internal messages: say less
      return res.status >= 500 ? busy('The route service is unavailable', 60) : res;
    } catch (e) {
      console.error('container fetch failed', (e as Error).message);
      return busy('The route service is starting', 30);
    } finally {
      this.inflight--;
    }
  }
}

interface Env {
  SERVICE: DurableObjectNamespace<InterwayService>;
  PER_IP: RateLimit; // every request per caller per Cloudflare location: rejects floods before they cost a second request
  MISS_IP: RateLimit; // requests per caller that reach the container
  ALL: RateLimit; // requests from everyone that reach the container, per location: a circuit breaker
}

const ROUTE_PARAMS = ['from', 'to', 'via', 'draft', 'air', 'beam', 'len', 'speed', 'current', 'lockmin', 'date', 'avoidLocks', 'avoidSea', 'coastal', 'format'];
const KEEP: Record<string, string[]> = { '/api/route': ROUTE_PARAMS, '/api/place': ['q'], '/api/waterway': ['id'], '/': [], '/llms.txt': [] };
const TTL: Record<string, number> = { '/api/route': 86400, '/api/place': 86400, '/api/waterway': 86400, '/': 3600, '/llms.txt': 3600 };
const MAX_URL = 2048, MAX_BODY = 32 * 1024;

function busy(msg: string, retry = 30): Response {
  return new Response(`${msg}; try again in ${retry} s.\n`, {
    status: 503, headers: { 'retry-after': String(retry), 'cache-control': 'no-store', 'access-control-allow-origin': '*' },
  });
}
const tooMany = () => new Response('Too many requests; slow down.\n', {
  status: 429, headers: { 'retry-after': '60', 'cache-control': 'no-store', 'access-control-allow-origin': '*' },
});

/** The same question always gives the same URL: only known parameters, sorted, trimmed, one value each. */
function normalise(url: URL): URL | null {
  const keep = KEEP[url.pathname];
  if (!keep) return null;
  const out = new URL(url.origin + url.pathname);
  for (const k of [...keep].sort()) {
    const v = url.searchParams.get(k)?.trim().replace(/\s+/g, ' ');
    if (v) out.searchParams.set(k, v);
  }
  return out;
}

/** For requests that will reach the container. */
async function limited(env: Env, ip: string): Promise<Response | null> {
  const [one, all] = await Promise.all([env.MISS_IP.limit({ key: ip }), env.ALL.limit({ key: 'all' })]);
  return one.success && all.success ? null : tooMany();
}

function toContainer(env: Env, request: Request, url: URL): Promise<Response> {
  // only the headers the service needs: no cookies, no client IP into the container
  const headers = new Headers({ 'x-forwarded-origin': url.origin });
  for (const h of ['content-type', 'accept', 'mcp-protocol-version', 'mcp-session-id']) {
    const v = request.headers.get(h);
    if (v) headers.set(h, v);
  }
  return getContainer(env.SERVICE, 'interway').fetch(new Request(url, { method: request.method, headers, body: request.body }));
}

/** Runs only on a Workers Cache miss. */
export class Cached extends WorkerEntrypoint<Env> {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const stop = await limited(this.env, request.headers.get('x-client-ip') ?? 'unknown');
    if (stop) return stop;
    const res = await toContainer(this.env, request, url);
    const out = new Response(res.body, res);
    out.headers.delete('set-cookie');
    // answers depend only on the request and the data: cache successes for a day, mistakes (400/404) for an hour
    const ttl = res.ok ? TTL[url.pathname] ?? 3600 : res.status === 400 || res.status === 404 ? 3600 : 0;
    out.headers.set('cache-control', ttl ? `public, max-age=${ttl}, stale-while-revalidate=3600` : 'no-store');
    return out;
  }
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    if (request.url.length > MAX_URL) return new Response('URL too long\n', { status: 414 });
    const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
    // the only key a service without accounts has; generous, since NAT and assistants' egress IPs are shared
    if (!(await env.PER_IP.limit({ key: ip })).success) return tooMany();
    if (request.method === 'GET' || request.method === 'HEAD') {
      const key = normalise(url);
      if (!key) return new Response(`Not found: ${url.pathname}. See ${url.origin}/\n`, { status: 404, headers: { 'cache-control': 'public, max-age=3600' } });
      return ctx.exports.Cached.fetch(new Request(key, { method: request.method, headers: { 'x-client-ip': ip } }));
    }
    if (request.method === 'OPTIONS') return toContainer(env, request, url);
    if (request.method !== 'POST' || url.pathname !== '/mcp') return new Response('Method not allowed\n', { status: 405, headers: { allow: 'GET, HEAD, POST, OPTIONS' } });
    if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY) return new Response('Body too large\n', { status: 413 });
    const body = await request.arrayBuffer(); // chunked bodies have no length: read, then check
    if (body.byteLength > MAX_BODY) return new Response('Body too large\n', { status: 413 });
    const stop = await limited(env, ip);
    if (stop) return stop;
    return toContainer(env, new Request(request, { body }), url);
  },
} satisfies ExportedHandler<Env>;

declare global {
  namespace Cloudflare {
    interface GlobalProps {
      mainModule: typeof import('./worker');
      durableNamespaces: 'InterwayService';
    }
  }
}
