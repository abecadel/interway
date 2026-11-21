import { describe, expect, it, vi } from 'vitest';
import { compass, fetchConditions, trendText } from './conditions';

const weather = { current: { time: '2026-11-21T12:00', temperature_2m: 6.4, wind_speed_10m: 12.3, wind_direction_10m: 225, wind_gusts_10m: 19.8, pressure_msl: 1008.2 },
  hourly: { pressure_msl: [1010.3, 1009.1, 1008.6, 1008.2] } };
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });

describe('weather and sea now', () => {
  it('reads wind, pressure and its trend, air, waves and water', async () => {
    const f = vi.fn(async (url: string) => (url.includes('marine') ? json({ current: { wave_height: 0.6, sea_surface_temperature: 11.2 } }) : json(weather)));
    const c = await fetchConditions(54.1234567, 18.6, f);
    expect(f.mock.calls[0][0]).toContain('latitude=54.1235&longitude=18.6000');
    expect(c).toEqual({ time: '2026-11-21T12:00', windKn: 12.3, gustKn: 19.8, windFrom: 225, pressureHpa: 1008.2, pressureTrend: -2.1, airC: 6.4, waveM: 0.6, seaC: 11.2 });
  });

  it('inland or without the sea service, waves and water are unknown', async () => {
    const inland = await fetchConditions(52, 21, async (url) => (url.includes('marine') ? json({ current: { wave_height: null } }) : json({ ...weather, hourly: undefined })));
    expect([inland.waveM, inland.seaC, inland.pressureTrend]).toEqual([null, null, null]);
    expect((await fetchConditions(52, 21, async (url) => (url.includes('marine') ? json({}, 400) : json(weather)))).waveM).toBeNull();
    expect((await fetchConditions(52, 21, async (url) => (url.includes('marine') ? json({}) : json(weather)))).seaC).toBeNull();
    expect((await fetchConditions(52, 21, async (url) => { if (url.includes('marine')) throw new Error('offline'); return json(weather); })).waveM).toBeNull();
    await expect(fetchConditions(52, 21, async () => json({}, 503))).rejects.toThrow('Weather not available (HTTP 503)');
  });

  it('names directions and trends', () => {
    expect([compass(0), compass(225), compass(350), compass(-90), compass(371)]).toEqual(['N', 'SW', 'N', 'W', 'N']);
    expect([trendText(null), trendText(0.2), trendText(-2.1), trendText(1.5)]).toEqual([null, 'steady', 'falling 2.1 hPa in 3 h', 'rising 1.5 hPa in 3 h']);
  });

  it('uses the browser fetch by default', async () => {
    const g = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json(weather));
    expect((await fetchConditions(1, 2)).windKn).toBe(12.3);
    g.mockRestore();
  });
});
