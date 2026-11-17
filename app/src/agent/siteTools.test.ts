import { describe, expect, it, vi } from 'vitest';
import type { LngLat } from '../graph/geo';
import type { RouteBrief } from '../ui/brief';
import { getModelContext, registerSiteTools, siteTools, type ModelContext, type PlannerBridge, type SiteTool } from './siteTools';

const brief = {
  title: 'A → B',
  stops: [{ km: 1, type: 'lock', name: 'Śluza', lat: 0, lon: 0 }, { km: 2, type: 'marina', name: 'Port', lat: 0, lon: 0 }],
} as unknown as RouteBrief;

function bridge(over: Partial<PlannerBridge> = {}) {
  let via: LngLat[] = [[1, 1]];
  const b: PlannerBridge = {
    planRoute: vi.fn(async () => brief),
    brief: vi.fn(() => brief),
    setVessel: vi.fn(),
    waypoints: () => via,
    setWaypoints: vi.fn((v: LngLat[]) => { via = v; }),
    findPlace: vi.fn(async (q: string) => (q === 'Toruń' ? [{ label: 'Toruń, PL', position: [18.6, 53.0] as LngLat }] : [])),
    ...over,
  };
  const tools = Object.fromEntries(siteTools(b).map((t) => [t.name, t])) as Record<string, SiteTool>;
  return { b, tools };
}

describe('site tools', () => {
  it('plans routes from coordinates or place names, keeping only valid vessel fields', async () => {
    const { b, tools } = bridge();
    const out = await tools.plan_route.execute({
      from: { lon: 21, lat: 52.2 }, to: 'Toruń', via: ['Toruń', { lon: 19, lat: 52.6 }],
      vessel: { draft: 1.2, beam: -1, speedKmh: 'fast', avoidLocks: true, colour: 'red' },
    });
    expect(out).toBe(brief);
    expect(b.planRoute).toHaveBeenCalledWith({
      from: [21, 52.2], to: [18.6, 53.0], via: [[18.6, 53.0], [19, 52.6]], vessel: { draft: 1.2, avoidLocks: true },
    });
    await tools.plan_route.execute({ from: 'Toruń', to: 'Toruń', vessel: 'big' });
    expect(b.planRoute).toHaveBeenLastCalledWith({ from: [18.6, 53.0], to: [18.6, 53.0], via: [], vessel: {} });
    await expect(tools.plan_route.execute({ from: 'Nowhere', to: 'Toruń' })).rejects.toThrow('No place found for from "Nowhere"');
    await expect(tools.plan_route.execute({ from: { lon: 500, lat: 1 }, to: 'Toruń' })).rejects.toThrow('from must be a place name or {lon, lat}');
    await expect(tools.plan_route.execute({ to: 'Toruń' })).rejects.toThrow('from must be');
  });

  it('reads the current route and its stops', async () => {
    const { tools } = bridge();
    expect(await tools.get_route_brief.execute({})).toBe(brief);
    expect(await tools.list_stops.execute({ types: ['lock'] })).toEqual([brief.stops[0]]);
    expect(await tools.list_stops.execute({})).toEqual(brief.stops);
    expect(tools.get_route_brief.annotations?.readOnlyHint).toBe(true);
    const none = bridge({ brief: () => null }).tools;
    await expect(none.get_route_brief.execute({})).rejects.toThrow('call plan_route first');
  });

  it('edits the vessel and the waypoints', async () => {
    const { b, tools } = bridge();
    expect(await tools.set_vessel.execute({ airDraft: 4.5, length: 'x' })).toEqual({ updated: ['airDraft'] });
    expect(b.setVessel).toHaveBeenCalledWith({ airDraft: 4.5 });
    expect(await tools.add_waypoint.execute({ point: 'Toruń', index: 0 })).toEqual({ waypoints: [[18.6, 53.0], [1, 1]] });
    expect(await tools.add_waypoint.execute({ point: { lon: 2, lat: 2 } })).toEqual({ waypoints: [[18.6, 53.0], [1, 1], [2, 2]] });
    expect(await tools.remove_waypoint.execute({ index: 1 })).toEqual({ waypoints: [[18.6, 53.0], [2, 2]] });
    expect(await tools.find_place.execute({ query: 'Toruń' })).toEqual([{ name: 'Toruń, PL', lon: 18.6, lat: 53.0 }]);
    expect(await tools.find_place.execute({})).toEqual([]);
  });

  it('registers only where the browser offers WebMCP', async () => {
    const registerTool = vi.fn();
    const ctx: ModelContext = { registerTool };
    expect(await registerSiteTools(bridge().b, ctx)).toBe(true);
    expect(registerTool.mock.calls.map(([t]) => t.name)).toEqual(
      ['plan_route', 'get_route_brief', 'list_stops', 'set_vessel', 'add_waypoint', 'remove_waypoint', 'find_place']);
    expect(await registerSiteTools(bridge().b, null)).toBe(false);

    expect(getModelContext({ modelContext: ctx } as unknown as Document, {} as Navigator)).toBe(ctx);
    expect(getModelContext({} as Document, { modelContext: ctx } as unknown as Navigator)).toBe(ctx);
    expect(getModelContext({ modelContext: {} } as unknown as Document, {} as Navigator)).toBeNull();
    expect(getModelContext()).toBeNull(); // jsdom has no WebMCP
  });
});
