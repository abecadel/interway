// HTTP and MCP front of the route service. Every answer is plain text or JSON a chat assistant can read:
//   GET  /                     what the service does and how to call it
//   GET  /api/route?from=&to=  the route brief (Markdown; ?format=json for JSON) with the website permalink
//   GET  /api/place?q=         places in the data matching a name
//   GET  /api/waterway?id=     a researched waterway sheet
//   POST /mcp                  MCP (streamable HTTP, JSON responses): tools plan_route, edit_route, find_place, get_waterway
import { WATERWAYS } from '../routing/waterways';
import { applyEdit, type Edit, type Engine, parseRequest, plan, requestFromLink, RequestError, type RouteRequest } from './engine';

export interface Options {
  /** the website the permalinks open, e.g. https://abecadel.github.io/interway/ */
  site: string;
  /** this service's own address, e.g. https://interway.example.workers.dev; empty: the address requests come in on */
  service: string;
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, mcp-session-id, mcp-protocol-version' };
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v, null, 1), { status, headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' } });
const markdown = (s: string, status = 200) => new Response(s, { status, headers: { ...CORS, 'content-type': 'text/markdown; charset=utf-8' } });

export function help(o: Options): string {
  return `# Interway route service

Plans boat routes on European inland waterways and seas (the planner at ${o.site}) and answers with a route brief
in Markdown: distance, time, locks, daily stages, the boat against the tightest limits on the route, closures by
month, rules by country, a "Before you go" checklist, and a permalink that opens the route on the website.

## Plan a route
GET ${o.service}/api/route?from=Wrocław&to=Monaco&draft=1.2&air=3&beam=3&len=9&speed=10&date=2027-05-01

- \`from\`, \`to\`: place names (towns, marinas, ports, locks in the data) or \`lon,lat\`
- \`via\`: stops in order, separated by \`;\` (names or \`lon,lat\`), e.g. \`via=Berlin;Strasbourg\`
- \`draft\`, \`air\` (air draft), \`beam\`, \`len\` (m); \`speed\` (km/h); \`current\` (m/s); \`lockmin\` (min per lock)
- \`date=YYYY-MM-DD\` departure; \`avoidLocks=1\`, \`avoidSea=1\`, \`coastal=1\`
- \`format=json\` for the brief as JSON

## Edit a route
Change the link's parameters and call it again: add a stop with \`via\` (in route order), change the boat or the
date. The brief ends with this service's link for the route ("Service link"), ready to change.

## Find a place, read a waterway sheet
GET ${o.service}/api/place?q=Mikołajki · GET ${o.service}/api/waterway?id=canal-du-midi

## MCP
POST ${o.service}/mcp (streamable HTTP): tools \`plan_route\`, \`edit_route\`, \`find_place\`, \`get_waterway\`.

Data © OpenStreetMap contributors (ODbL), towns © GeoNames (CC BY 4.0), bathymetry © EMODnet (CC BY 4.0). Not for navigation.
`;
}

async function routeText(engine: Engine, r: RouteRequest, o: Options): Promise<string> {
  const p = await plan(engine, r, o);
  return `${p.markdown}\nPermalink (open on the website): ${p.permalink}\n\nService link (change it to edit the route): ${p.serviceLink}\n`;
}

const vesselSchema = {
  type: 'object',
  description: 'Boat and trip; omitted fields keep their values',
  properties: {
    draft: { type: 'number', description: 'm' }, airDraft: { type: 'number', description: 'height above water, m' },
    beam: { type: 'number', description: 'm' }, length: { type: 'number', description: 'm' },
    speedKmh: { type: 'number' }, currentMs: { type: 'number' }, lockPenaltyMin: { type: 'number' },
    avoidLocks: { type: 'boolean' }, avoidSea: { type: 'boolean' }, coastal: { type: 'boolean' },
    departure: { type: 'string', description: 'YYYY-MM-DD' },
  },
};
const place = { type: 'string', description: 'a place name (town, marina, port, lock) or "lon,lat"' };

export const TOOLS = [
  {
    name: 'plan_route',
    description: 'Plan a boat route on European inland waterways and seas. Returns the route brief (Markdown) with a website permalink and a service link to edit it.',
    inputSchema: { type: 'object', properties: { from: place, to: place, via: { type: 'array', items: place, description: 'stops in route order' }, vessel: vesselSchema }, required: ['from', 'to'] },
  },
  {
    name: 'edit_route',
    description: 'Change a planned route: add, move or remove a stop, change the start, destination, boat or date. Give the route\'s service link or permalink.',
    inputSchema: {
      type: 'object',
      properties: {
        link: { type: 'string', description: 'the "Service link" or permalink of the route to change' },
        add_stop: { type: 'object', properties: { place, index: { type: 'number', description: 'position among the stops (0 = first); default: last' } }, required: ['place'] },
        remove_stop: { type: 'object', properties: { index: { type: 'number' } }, required: ['index'] },
        move_stop: { type: 'object', properties: { from: { type: 'number' }, to: { type: 'number' } }, required: ['from', 'to'] },
        from: place, to: place, vessel: vesselSchema,
      },
      required: ['link'],
    },
  },
  {
    name: 'find_place',
    description: 'Places in the data (towns, marinas, ports, locks, fuel) matching a name, with coordinates.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
  {
    name: 'get_waterway',
    description: 'A researched waterway sheet (navigability, depth, bridges, locks, season by month, rules, sources) by id; the brief lists the ids.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
];

const VESSEL_TO_PARAM: Record<string, string> = { draft: 'draft', airDraft: 'air', beam: 'beam', length: 'len', speedKmh: 'speed', currentMs: 'current', lockPenaltyMin: 'lockmin' };

/** An MCP request's vessel object as link parameters, so it goes through the same checks as a link. */
function vesselParams(q: URLSearchParams, v: unknown) {
  if (!v || typeof v !== 'object') return;
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (k in VESSEL_TO_PARAM) q.set(VESSEL_TO_PARAM[k], String(x));
    else if (k === 'departure') q.set('date', String(x));
    else if (['avoidLocks', 'avoidSea', 'coastal'].includes(k) && x) q.set(k, '1');
  }
}

async function call(engine: Engine, o: Options, name: string, a: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'plan_route': {
      const q = new URLSearchParams({ from: String(a.from ?? ''), to: String(a.to ?? '') });
      if (Array.isArray(a.via) && a.via.length) q.set('via', a.via.map(String).join(';'));
      vesselParams(q, a.vessel);
      return routeText(engine, parseRequest(q), o);
    }
    case 'edit_route': {
      const base = requestFromLink(String(a.link ?? ''));
      const vq = new URLSearchParams({ from: 'x', to: 'x' });
      vesselParams(vq, a.vessel);
      const edit: Edit = { ...(a as Edit), vessel: parseRequest(vq).vessel };
      return routeText(engine, applyEdit(base, edit), o);
    }
    case 'find_place': {
      const hits = engine.index.search(String(a.query ?? ''), undefined, 8);
      return hits.length ? hits.map((p) => `- ${p.label}: ${p.position[0]},${p.position[1]}`).join('\n') : `Nothing found for "${String(a.query ?? '')}"`;
    }
    case 'get_waterway':
      return waterwayText(String(a.id ?? ''));
    default:
      throw new RequestError(`Unknown tool ${name}`);
  }
}

function waterwayText(id: string): string {
  const w = WATERWAYS.find((x) => x.id === id);
  if (!w) throw new RequestError(`No waterway sheet "${id}"`);
  return JSON.stringify(w, null, 1);
}

interface RpcRequest { jsonrpc: '2.0'; id?: number | string | null; method: string; params?: Record<string, unknown> }

async function rpc(engine: Engine, o: Options, m: RpcRequest): Promise<unknown> {
  switch (m.method) {
    case 'initialize':
      return { protocolVersion: (m.params?.protocolVersion as string) ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'interway', version: '1.0.0' },
        instructions: 'Plan and edit boat routes in Europe. Call plan_route, then edit_route with the route\'s service link to add stops or change the boat. Always show the user the permalink.' };
    case 'ping':
      return {};
    case 'tools/list':
      return { tools: TOOLS };
    case 'tools/call': {
      const name = String(m.params?.name ?? '');
      try {
        return { content: [{ type: 'text', text: await call(engine, o, name, (m.params?.arguments ?? {}) as Record<string, unknown>) }] };
      } catch (e) {
        if (!(e instanceof RequestError)) throw e;
        return { content: [{ type: 'text', text: e.message }], isError: true };
      }
    }
    default:
      throw Object.assign(new Error(`Method not found: ${m.method}`), { code: -32601 });
  }
}

async function mcp(engine: Engine, o: Options, req: Request): Promise<Response> {
  let body: RpcRequest | RpcRequest[];
  try {
    body = (await req.json()) as RpcRequest | RpcRequest[];
  } catch {
    return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400);
  }
  const one = async (m: RpcRequest) => {
    try {
      return { jsonrpc: '2.0', id: m.id, result: await rpc(engine, o, m) };
    } catch (e) {
      return { jsonrpc: '2.0', id: m.id, error: { code: (e as { code?: number }).code ?? -32603, message: (e as Error).message } };
    }
  };
  const list = Array.isArray(body) ? body : [body];
  // notifications (no id) get no answer
  const answers = await Promise.all(list.filter((m) => m.id !== undefined).map(one));
  if (!answers.length) return new Response(null, { status: 202, headers: CORS });
  return json(Array.isArray(body) ? answers : answers[0]);
}

export async function handle(engine: Engine, req: Request, options: Options): Promise<Response> {
  const url = new URL(req.url);
  // without a configured address, links point back to wherever the request came in
  const o = options.service ? options : { ...options, service: url.origin };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...CORS, 'access-control-allow-methods': 'GET, POST, OPTIONS' } });
  if (url.pathname === '/mcp') {
    if (req.method !== 'POST') return new Response('Use POST for MCP', { status: 405, headers: CORS });
    return mcp(engine, o, req);
  }
  try {
    switch (url.pathname) {
      case '/':
      case '/llms.txt':
        return markdown(help(o));
      case '/api/route': {
        const r = parseRequest(url.searchParams);
        if (url.searchParams.get('format') === 'json') {
          const p = await plan(engine, r, o);
          return json({ ...p.brief, permalink: p.permalink, serviceLink: p.serviceLink });
        }
        return markdown(await routeText(engine, r, o));
      }
      case '/api/place': {
        const hits = engine.index.search(url.searchParams.get('q') ?? '', undefined, 8);
        return json(hits.map((p) => ({ name: p.label, lon: p.position[0], lat: p.position[1] })));
      }
      case '/api/waterway':
        return json(JSON.parse(waterwayText(url.searchParams.get('id') ?? '')));
      default:
        return markdown(`Not found: ${url.pathname}. See ${o.service}/`, 404);
    }
  } catch (e) {
    if (e instanceof RequestError) return markdown(`${e.message}\n\nSee ${o.service}/ for how to call the service.\n`, 400);
    throw e;
  }
}
