// WebMCP "site tools": the page offers its planner to AI agents browsing it (document.modelContext, e.g. the
// ChatGPT desktop app's built-in browser; navigator.modelContext in older drafts). No server is involved: the
// tools drive the same in-browser router and state as the user interface.
import type { LngLat } from '../graph/geo';
import type { VesselProfile } from '../routing/router';
import type { PoiType } from '../routing/service';
import type { BriefStop, RouteBrief } from '../ui/brief';
import type { Place } from '../ui/search';

export interface SiteTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean };
  execute: (input: Record<string, unknown>) => Promise<unknown>;
}

export interface ModelContext {
  registerTool: (tool: SiteTool) => unknown;
}

/** What the tools can do with the planner; implemented by the app. */
export interface PlannerBridge {
  /** computes the route, shows it on the page and returns its brief */
  planRoute: (r: { from: LngLat; to: LngLat; via: LngLat[]; vessel: Partial<VesselProfile> }) => Promise<RouteBrief>;
  /** the brief of the route on the page, or null */
  brief: () => RouteBrief | null;
  /** a route is being computed for the page's current points and vessel */
  routing: () => boolean;
  /** why the page's route failed, or null */
  error: () => string | null;
  setVessel: (v: Partial<VesselProfile>) => void;
  waypoints: () => LngLat[];
  setWaypoints: (via: LngLat[]) => void;
  findPlace: (query: string) => Promise<Place[]>;
}

const point = {
  description: 'A place name (e.g. "Toruń marina") or {lon, lat} in decimal degrees',
  oneOf: [
    { type: 'string' },
    { type: 'object', properties: { lon: { type: 'number' }, lat: { type: 'number' } }, required: ['lon', 'lat'] },
  ],
};
const vessel = {
  type: 'object',
  description: 'Vessel; omitted fields keep their current values',
  properties: {
    draft: { type: 'number', description: 'm' }, airDraft: { type: 'number', description: 'height above water, m' },
    beam: { type: 'number', description: 'm' }, length: { type: 'number', description: 'm' },
    speedKmh: { type: 'number', description: 'cruising speed through the water, km/h' },
    currentMs: { type: 'number', description: 'river current assumed where no researched value exists, m/s' },
    lockPenaltyMin: { type: 'number', description: 'minutes per lock' }, avoidLocks: { type: 'boolean' },
    avoidSea: { type: 'boolean', description: 'keep to inland waterways where possible' },
    coastal: { type: 'boolean', description: 'small boat: keep near the coast, harbour to harbour, instead of crossing open sea' },
    departure: { type: 'string', description: 'departure date YYYY-MM-DD: waterways usually closed in the month they are reached are avoided, stages get dates' },
  },
  additionalProperties: false,
};
const VESSEL_KEYS = ['draft', 'airDraft', 'beam', 'length', 'speedKmh', 'currentMs', 'lockPenaltyMin', 'avoidLocks', 'avoidSea', 'coastal', 'departure'] as const;

export function getModelContext(doc: Document = document, nav: Navigator = navigator): ModelContext | null {
  const ctx = (doc as { modelContext?: ModelContext }).modelContext ?? (nav as { modelContext?: ModelContext }).modelContext;
  return typeof ctx?.registerTool === 'function' ? ctx : null;
}

const FLAGS = new Set<string>(['avoidLocks', 'avoidSea', 'coastal']);
/** how long get_route_brief and list_stops wait for a route being recomputed (after set_vessel, a waypoint) */
export const ROUTE_WAIT_MS = 60_000;

function cleanVessel(v: unknown): Partial<VesselProfile> {
  const out: Record<string, unknown> = {};
  if (v && typeof v === 'object') {
    for (const k of VESSEL_KEYS) {
      const x = (v as Record<string, unknown>)[k];
      const ok = k === 'departure' ? typeof x === 'string' && /^(\d{4}-\d{2}-\d{2})?$/.test(x)
        : FLAGS.has(k) ? typeof x === 'boolean' : typeof x === 'number' && Number.isFinite(x) && x >= 0;
      if (ok) out[k] = x;
    }
  }
  return out as Partial<VesselProfile>;
}

export function siteTools(bridge: PlannerBridge): SiteTool[] {
  const resolve = async (p: unknown, what: string): Promise<LngLat> => {
    if (typeof p === 'string') {
      const [hit] = await bridge.findPlace(p);
      if (!hit) throw new Error(`No place found for ${what} "${p}"`);
      return hit.position;
    }
    const { lon, lat } = (p ?? {}) as { lon?: unknown; lat?: unknown };
    if (typeof lon !== 'number' || typeof lat !== 'number' || Math.abs(lon) > 180 || Math.abs(lat) > 90) {
      throw new Error(`${what} must be a place name or {lon, lat}`);
    }
    return [lon, lat];
  };
  // after set_vessel or a waypoint change the page computes the route again: wait for it rather than fail
  const current = async () => {
    const until = Date.now() + ROUTE_WAIT_MS;
    while (!bridge.brief() && bridge.routing() && Date.now() < until) await new Promise((r) => setTimeout(r, 200));
    const b = bridge.brief();
    if (b) return b;
    if (bridge.routing()) throw new Error('The route is still being computed: call get_route_brief again in a moment');
    const e = bridge.error();
    throw new Error(e ? `No route: ${e}` : 'No route on the page yet: call plan_route first');
  };
  return [
    {
      name: 'plan_route',
      description:
        'Plan a boat route on European inland waterways and seas. Shows it on the page and returns a brief: distance, time, '
        + 'locks, open-sea distance, towns, legs, daily stages, stops (locks, bridges, marinas, fuel...), vessel checks, '
        + 'hazards and a shareable link.',
      inputSchema: {
        type: 'object',
        properties: { from: point, to: point, via: { type: 'array', items: point, description: 'waypoints in order' }, vessel },
        required: ['from', 'to'],
      },
      execute: async (input) => {
        const from = await resolve(input.from, 'from');
        const to = await resolve(input.to, 'to');
        const via: LngLat[] = [];
        for (const [i, p] of ((input.via as unknown[]) ?? []).entries()) via.push(await resolve(p, `via[${i}]`));
        return bridge.planRoute({ from, to, via, vessel: cleanVessel(input.vessel) });
      },
    },
    {
      name: 'get_route_brief',
      description: 'The brief of the route currently shown on the page (see plan_route); waits while it is being recomputed.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      execute: async () => current(),
    },
    {
      name: 'list_stops',
      description: 'Stops along the current route in order, with km from the start; optionally only some types.',
      inputSchema: {
        type: 'object',
        properties: {
          types: {
            type: 'array',
            items: { enum: ['lock', 'bridge', 'marina', 'port', 'fuel', 'slipway', 'water', 'sanitary', 'place'] },
          },
        },
      },
      annotations: { readOnlyHint: true },
      execute: async (input) => {
        const types = input.types as PoiType[] | undefined;
        return (await current()).stops.filter((s: BriefStop) => !types?.length || types.includes(s.type));
      },
    },
    {
      name: 'set_vessel',
      description: 'Change the vessel or trip (any of the fields below: dimensions, speed, departure date, avoid locks or sea, '
        + 'keep near the coast); the route is recomputed: get_route_brief then waits for it.',
      inputSchema: vessel,
      execute: async (input) => {
        const v = cleanVessel(input);
        bridge.setVessel(v);
        return { updated: Object.keys(v) };
      },
    },
    {
      name: 'add_waypoint',
      description: 'Add a waypoint the route must pass (e.g. to choose a canal or visit a town); index defaults to the end.',
      inputSchema: { type: 'object', properties: { point, index: { type: 'integer', minimum: 0 } }, required: ['point'] },
      execute: async (input) => {
        const p = await resolve(input.point, 'point');
        const via = [...bridge.waypoints()];
        via.splice(typeof input.index === 'number' ? input.index : via.length, 0, p);
        bridge.setWaypoints(via);
        return { waypoints: via };
      },
    },
    {
      name: 'remove_waypoint',
      description: 'Remove the waypoint at index (0 = first).',
      inputSchema: { type: 'object', properties: { index: { type: 'integer', minimum: 0 } }, required: ['index'] },
      execute: async (input) => {
        const via = bridge.waypoints().filter((_, i) => i !== input.index);
        bridge.setWaypoints(via);
        return { waypoints: via };
      },
    },
    {
      name: 'find_place',
      description: 'Look up places (towns, marinas, locks) by name; returns candidates with lon/lat.',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      annotations: { readOnlyHint: true },
      execute: async (input) => (await bridge.findPlace(String(input.query ?? ''))).map((p) => ({ name: p.label, lon: p.position[0], lat: p.position[1] })),
    },
  ];
}

/** Registers the tools when the browser offers WebMCP; returns whether it did. */
export async function registerSiteTools(bridge: PlannerBridge, ctx: ModelContext | null = getModelContext()): Promise<boolean> {
  if (!ctx) return false;
  for (const tool of siteTools(bridge)) await ctx.registerTool(tool);
  return true;
}
