// Weather and sea now at a place, for a day's fishing: wind and gusts, pressure and its trend (falling pressure
// often brings fish on the bite), air temperature, and at sea the wave height and water temperature.
// Data from Open-Meteo (free, CC BY 4.0, no key; its free API is for non-commercial use, which Interway is).

export interface Conditions {
  /** ISO time of the reading (UTC) */
  time: string;
  windKn: number;
  gustKn: number;
  /** where the wind comes from, degrees */
  windFrom: number;
  pressureHpa: number;
  /** change over the last 3 hours, hPa; null when not known */
  pressureTrend: number | null;
  airC: number;
  /** at sea only; null inland or when not known */
  waveM: number | null;
  seaC: number | null;
}

type Fetch = (url: string) => Promise<Response>;

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const compass = (deg: number) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];

export async function fetchConditions(lat: number, lon: number, fetchFn: Fetch = (u) => fetch(u)): Promise<Conditions> {
  const at = `latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}`;
  const res = await fetchFn(`https://api.open-meteo.com/v1/forecast?${at}&current=temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl`
    + '&hourly=pressure_msl&past_hours=3&forecast_hours=1&wind_speed_unit=kn&timezone=GMT');
  if (!res.ok) throw new Error(`Weather not available (HTTP ${res.status})`);
  const w = await res.json() as { current: Record<string, number | string>; hourly?: { pressure_msl?: (number | null)[] } };
  const c = w.current;
  const before = w.hourly?.pressure_msl?.[0];
  // the sea: inland points have no waves; a failure there just leaves them unknown
  const sea = await fetchFn(`https://marine-api.open-meteo.com/v1/marine?${at}&current=wave_height,sea_surface_temperature&timezone=GMT`)
    .then(async (r) => (r.ok ? ((await r.json()) as { current?: Record<string, number | null> }).current ?? {} : {}), () => ({} as Record<string, number | null>));
  return {
    time: String(c.time), windKn: Number(c.wind_speed_10m), gustKn: Number(c.wind_gusts_10m), windFrom: Number(c.wind_direction_10m),
    pressureHpa: Number(c.pressure_msl), pressureTrend: typeof before === 'number' ? Math.round((Number(c.pressure_msl) - before) * 10) / 10 : null,
    airC: Number(c.temperature_2m), waveM: typeof sea.wave_height === 'number' ? sea.wave_height : null,
    seaC: typeof sea.sea_surface_temperature === 'number' ? sea.sea_surface_temperature : null,
  };
}

/** "falling 2.1 hPa in 3 h" */
export function trendText(t: number | null): string | null {
  if (t === null) return null;
  if (Math.abs(t) < 0.5) return 'steady';
  return `${t < 0 ? 'falling' : 'rising'} ${Math.abs(t)} hPa in 3 h`;
}
