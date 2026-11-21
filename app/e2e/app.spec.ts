import { expect, test, type BrowserContext, type Page } from '@playwright/test';

// A route on the Oder-Havel-Kanal near Niederfinow, and points along an earlier stretch of it.
const ROUTE = '?from=13.90,52.852&to=14.0,52.86';
const NAV_ROUTE = '?from=13.27,52.77&to=13.96,52.852';
const ALONG: [number, number][] = [[13.726, 52.8586], [13.7883, 52.853], [13.8142, 52.8546], [13.8741, 52.8593]];
const MORE = 'More: offline map, brief for AI, GPX';

const errors = (page: Page) => {
  const list: string[] = [];
  page.on('pageerror', (e) => list.push(e.message));
  return list;
};
const move = async (context: BrowserContext, page: Page, [longitude, latitude]: [number, number]) => {
  await context.setGeolocation({ longitude, latitude });
  await page.waitForTimeout(1200);
};

test('plans a route from a link, with distance and locks', async ({ page }) => {
  const errs = errors(page);
  await page.goto(ROUTE);
  await expect(page.getByText(MORE)).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('.summary')).toContainText(/\d+(\.\d)? km.*\d+ locks?/);
  expect(errs).toEqual([]);
});

test('search finds a lock and opens its place sheet', async ({ page }) => {
  await page.goto('');
  await page.waitForFunction(() => /edges/.test(document.body.innerText), null, { timeout: 90_000 });
  await page.getByPlaceholder('Search marinas, locks, towns').fill('Schleuse Liepe');
  await page.getByText(/Schleuse Liepe/).first().click();
  await expect(page.getByLabel('Place').first()).toContainText('Lock');
});

test('works offline from the first visit, for a route link never opened', async ({ page, context }) => {
  const errs = errors(page);
  await page.goto(ROUTE);
  await expect(page.getByText(MORE)).toBeVisible({ timeout: 90_000 });
  await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 90_000 });
  const cached = await page.evaluate(async () => (await (await caches.open('interway-data-v1')).keys()).length);
  expect(cached).toBeGreaterThanOrEqual(3);
  await context.setOffline(true);
  await page.goto('?from=13.80,52.83&to=14.0,52.86');
  await expect(page.getByText(MORE)).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.summary')).toContainText(/km/);
  expect(errs).toEqual([]);
});

test('navigates: warns of a lock, and re-routes from the boat when off the route', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ longitude: ALONG[0][0], latitude: ALONG[0][1] });
  await context.addInitScript(() => {
    const w = window as unknown as { __banner: string[] };
    w.__banner = [];
    new MutationObserver(() => {
      const b = document.querySelector('.nav-reroute');
      if (b?.textContent && w.__banner.at(-1) !== b.textContent) w.__banner.push(b.textContent);
    }).observe(document, { childList: true, subtree: true });
  });
  await page.goto(NAV_ROUTE);
  await page.getByText('Start', { exact: true }).click({ timeout: 90_000 });
  for (const p of ALONG) await move(context, page, p);
  await expect(page.locator('.nav-next')).toContainText(/Lock in \d/);
  // 400 m north of the canal, moving east: off the route
  const [lon, lat] = ALONG[3];
  for (let k = 0; k < 5; k++) await move(context, page, [lon + k * 0.0003, lat + 0.0036]);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __banner: string[] }).__banner)).toContain('Off the route: re-routing from here…');
  await expect(page.locator('.nav-reroute')).toHaveCount(0, { timeout: 30_000 });
  // the banner clears once the new route from the boat has arrived; navigation goes on along it
  await expect(page.locator('.nav-panel')).toBeVisible();
  await expect(page.locator('.nav-next')).toContainText(/Lock in \d/);
});
