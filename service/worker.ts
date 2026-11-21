// Cloudflare Worker in front of the route service: every request goes to the container (see Dockerfile). The
// container sleeps after half an hour without requests; the next request starts it again (about 20 s while it
// loads the data).
import { Container, getContainer } from '@cloudflare/containers';

export class InterwayService extends Container {
  defaultPort = 8080;
  sleepAfter = '30m';
}

interface Env {
  SERVICE: DurableObjectNamespace<InterwayService>;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // one instance holds the whole network in memory: all requests share it; links in its answers point here
    const forwarded = new Request(request, { headers: new Headers(request.headers) });
    forwarded.headers.set('x-forwarded-origin', new URL(request.url).origin);
    return getContainer(env.SERVICE, 'interway').fetch(forwarded);
  },
};
