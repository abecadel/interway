// Node entry of the route service (run in a container): loads the data from DATA_DIR or DATA_URL, then answers HTTP.
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { type Engine, loadEngine, type ReadFile } from './engine';
import { handle, type Options } from './handler';
import { searchPlaces } from '../ui/search';

/** Data from a directory on disk, or fetched from a URL (the website's data folder). */
export function dataReader(env: { DATA_DIR?: string; DATA_URL?: string }, fetchFn: typeof fetch = fetch): ReadFile {
  if (env.DATA_URL) {
    const base = env.DATA_URL.endsWith('/') ? env.DATA_URL : env.DATA_URL + '/';
    return async (name) => {
      const res = await fetchFn(base + name);
      if (!res.ok) throw new Error(`${base + name}: HTTP ${res.status}`);
      return res.arrayBuffer();
    };
  }
  const dir = env.DATA_DIR ?? 'data';
  return async (name) => {
    const b = await readFile(join(dir, name));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  };
}

async function body(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

/** The HTTP server: Node requests to Fetch requests for the handler and back. */
export function serve(engine: Engine, o: Options): Server {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      try {
        // the public address: the Worker in front says it (x-forwarded-origin), else the Host header
        const fwd = req.headers['x-forwarded-origin'];
        const url = new URL(req.url!, typeof fwd === 'string' ? fwd : `http://${req.headers.host}`);
        const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
        const r = await handle(engine, new Request(url, {
          method: req.method, headers: req.headers as Record<string, string>, ...(hasBody ? { body: new Uint8Array(await body(req)) } : {}),
        }), o);
        res.writeHead(r.status, Object.fromEntries(r.headers));
        res.end(Buffer.from(await r.arrayBuffer()));
      } catch (e) {
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(`Internal error: ${(e as Error).message}`);
      }
    })();
  });
}

/** Port and addresses from the environment: PORT, SITE_URL (the website), SERVICE_URL (this service's public address;
 *  unset: the address each request comes in on, e.g. the Worker's in front of the container). */
export function settings(env: Record<string, string | undefined>): { port: number; options: Options } {
  const port = Number(env.PORT ?? 8080);
  return { port, options: { site: env.SITE_URL ?? 'https://abecadel.github.io/interway/', service: (env.SERVICE_URL ?? '').replace(/\/$/, '') } };
}

export async function main(env: Record<string, string | undefined> = process.env): Promise<Server> {
  const engine = await loadEngine(dataReader(env), env.GEOCODE === '0' ? undefined : searchPlaces);
  const { port, options: o } = settings(env);
  const server = serve(engine, o);
  await new Promise<void>((resolve) => server.listen(port, resolve));
  console.log(`Interway route service on port ${port}: ${engine.router.graph.nodeCount} nodes, data ${engine.dataId}`);
  return server;
}
