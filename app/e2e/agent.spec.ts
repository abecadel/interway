import { expect, test } from '@playwright/test';

// The app as an AI agent uses it: through its WebMCP site tools (as in an agent's built-in browser), and by following
// llms.txt (build a link, open it, read the result).

type Tool = { name: string; execute: (input: Record<string, unknown>) => Promise<unknown> };

test.beforeEach(async ({ context }) => {
  // the agent's browser: collects the tools the page registers
  await context.addInitScript(() => {
    const w = window as unknown as { __tools: Record<string, Tool> };
    w.__tools = {};
    (document as unknown as { modelContext: unknown }).modelContext = { registerTool: (t: Tool) => { w.__tools[t.name] = t; } };
  });
});

const call = (page: import('@playwright/test').Page, name: string, input: Record<string, unknown> = {}) =>
  page.evaluate(async ([n, i]) => {
    const t = (window as unknown as { __tools: Record<string, Tool> }).__tools[n as string];
    try {
      return { ok: true, value: JSON.parse(JSON.stringify(await t.execute(i as Record<string, unknown>))) };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }, [name, input] as const);

test('an agent plans and edits a route with the site tools', async ({ page }) => {
  await page.goto('');
  await page.waitForFunction(() => Object.keys((window as unknown as { __tools: object }).__tools).length >= 7, null, { timeout: 90_000 });
  expect(await page.evaluate(() => Object.keys((window as unknown as { __tools: object }).__tools).sort())).toEqual(
    ['add_waypoint', 'find_place', 'get_route_brief', 'list_stops', 'plan_route', 'remove_waypoint', 'set_vessel']);

  // asking for the brief before planning explains what to do
  const early = await call(page, 'get_route_brief');
  expect(early.ok).toBe(false);
  expect(early.error).toContain('call plan_route first');

  // a place by name (the local index of the waterway data works without the search service)
  const found = await call(page, 'find_place', { query: 'Schleuse Liepe' });
  expect(found.ok).toBe(true);
  const liepe = (found.value as { name: string; lon: number; lat: number }[]).find((p) => p.name.includes('Liepe'));
  expect(liepe).toBeTruthy();

  // plan: coordinates and a vessel; the page shows the route too
  const planned = await call(page, 'plan_route', { from: { lon: 13.9, lat: 52.852 }, to: { lon: 14.0, lat: 52.86 }, vessel: { draft: 1.2, beam: 3.2 } });
  expect(planned.ok).toBe(true);
  const brief = planned.value as { totals: { km: number; locks: number }; link: string; vessel: { draft: number; beam: number }; stages: unknown[] };
  expect(brief.totals.km).toBeGreaterThan(5);
  expect(brief.vessel).toMatchObject({ draft: 1.2, beam: 3.2 });
  expect(brief.link).toContain('draft=1.2');
  expect(brief.stages.length).toBeGreaterThan(0);
  await expect(page.locator('.summary')).toContainText(/km/);

  // a waypoint at the lock found by name, then the stops of that kind
  const added = await call(page, 'add_waypoint', { point: { lon: liepe!.lon, lat: liepe!.lat } });
  expect(added.ok).toBe(true);
  await expect.poll(async () => ((await call(page, 'get_route_brief')).value as { link?: string } | undefined)?.link ?? '',
    { timeout: 30_000 }).toContain('via=');
  const locks = await call(page, 'list_stops', { types: ['lock'] });
  expect(locks.ok).toBe(true);
  expect((locks.value as { type: string }[]).every((s) => s.type === 'lock')).toBe(true);

  // change the vessel: the route is recomputed with it
  expect((await call(page, 'set_vessel', { airDraft: 4.5, coastal: true })).value).toEqual({ updated: ['airDraft', 'coastal'] });
  // the route is recomputed in the worker: poll until the brief reflects the new vessel
  await expect.poll(async () => ((await call(page, 'get_route_brief')).value as { vessel?: object } | undefined)?.vessel,
    { timeout: 30_000 }).toMatchObject({ airDraft: 4.5, coastal: true });

  expect((await call(page, 'remove_waypoint', { index: 0 })).value).toEqual({ waypoints: [] });

  // a place that does not exist: a clear error, not a crash
  const lost = await call(page, 'plan_route', { from: 'Xqzzyville harbour', to: { lon: 14.0, lat: 52.86 } });
  expect(lost.ok).toBe(false);
});

test('an agent follows llms.txt: builds a link, opens it and reads the route', async ({ page, request }) => {
  const llms = await (await request.get('llms.txt')).text();
  expect(llms).toContain('?from=LON,LAT&to=LON,LAT');
  for (const p of ['via', 'draft', 'air', 'beam', 'len', 'speed', 'avoidLocks', 'avoidSea', 'coastal']) expect(llms).toContain(`\`${p}`);
  // the link an agent writes from those instructions
  await page.goto('?from=13.90,52.852&to=14.0,52.86&draft=1.2&avoidLocks=1');
  await expect(page.locator('.summary')).toContainText(/\d+(\.\d)? km/, { timeout: 90_000 });
  const brief = await page.evaluate(async () =>
    (await (window as unknown as { __tools: Record<string, Tool> }).__tools.get_route_brief.execute({})) as { vessel: { draft: number; avoidLocks: boolean } });
  expect(brief.vessel).toMatchObject({ draft: 1.2, avoidLocks: true });
});
