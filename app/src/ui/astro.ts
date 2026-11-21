// Sun and moon for anglers, computed on the device (works offline): sunrise and sunset, the moon's phase, rise,
// set and transits, and the solunar periods (major: about 2 h around the moon's upper and lower transit; minor:
// about 1 h around moonrise and moonset). Low-precision formulas from the Astronomical Almanac (as in suncalc):
// good to a few minutes, enough for planning a day's fishing, not for navigation.

const RAD = Math.PI / 180;
const E = RAD * 23.4397; // obliquity of the ecliptic
const J2000 = 2451545;
const DAY_MS = 86_400_000;

const days = (t: number) => t / DAY_MS + 2440587.5 - J2000;
const rightAscension = (l: number, b: number) => Math.atan2(Math.sin(l) * Math.cos(E) - Math.tan(b) * Math.sin(E), Math.cos(l));
const declination = (l: number, b: number) => Math.asin(Math.sin(b) * Math.cos(E) + Math.cos(b) * Math.sin(E) * Math.sin(l));
const sidereal = (d: number, lw: number) => RAD * (280.16 + 360.9856235 * d) - lw;
const altitude = (h: number, phi: number, dec: number) => Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(h));

function sunCoords(d: number) {
  const m = RAD * (357.5291 + 0.98560028 * d);
  const c = RAD * (1.9148 * Math.sin(m) + 0.02 * Math.sin(2 * m) + 0.0003 * Math.sin(3 * m));
  const l = m + c + RAD * 102.9372 + Math.PI;
  return { dec: declination(l, 0), ra: rightAscension(l, 0) };
}

function moonCoords(d: number) {
  const l = RAD * (218.316 + 13.176396 * d), m = RAD * (134.963 + 13.064993 * d), f = RAD * (93.272 + 13.22935 * d);
  const lon = l + RAD * 6.289 * Math.sin(m), lat = RAD * 5.128 * Math.sin(f);
  return { ra: rightAscension(lon, lat), dec: declination(lon, lat), dist: 385001 - 20905 * Math.cos(m) };
}

/** The sun's and the moon's altitude (radians) at time t (ms) over a place. */
export function sunAltitude(t: number, lat: number, lon: number): number {
  const d = days(t), s = sunCoords(d);
  return altitude(sidereal(d, -lon * RAD) - s.ra, lat * RAD, s.dec);
}

export function moonAltitude(t: number, lat: number, lon: number): number {
  const d = days(t), m = moonCoords(d);
  const h = sidereal(d, -lon * RAD) - m.ra;
  const a = altitude(h, lat * RAD, m.dec);
  return a + RAD * 0.017 / Math.tan(a + RAD * 10.26 / (a / RAD + 5.1)); // refraction near the horizon
}

/** The moon's illuminated fraction (0 new – 1 full) and whether it is waxing. */
export function moonPhase(t: number): { fraction: number; waxing: boolean; name: string } {
  const d = days(t), s = sunCoords(d), m = moonCoords(d);
  const sdist = 149598000;
  const phi = Math.acos(Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra));
  const inc = Math.atan2(sdist * Math.sin(phi), m.dist - sdist * Math.cos(phi));
  const angle = Math.atan2(Math.cos(s.dec) * Math.sin(s.ra - m.ra),
    Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra));
  const fraction = (1 + Math.cos(inc)) / 2, waxing = angle < 0;
  const name = fraction < 0.03 ? 'new moon' : fraction > 0.97 ? 'full moon'
    : fraction < 0.47 ? (waxing ? 'waxing crescent' : 'waning crescent')
      : fraction > 0.53 ? (waxing ? 'waxing gibbous' : 'waning gibbous')
        : waxing ? 'first quarter' : 'last quarter';
  return { fraction, waxing, name };
}

export interface DayEvents {
  sunrise: number | null;
  sunset: number | null;
  moonrise: number | null;
  moonset: number | null;
  /** the moon's highest and lowest points (solunar major periods centre on them) */
  moonUpper: number | null;
  moonLower: number | null;
}

const STEP = 10 * 60_000; // sample every 10 minutes, interpolate crossings

/** Rise, set and transits within the 24 h from `from` (ms), sampled every 10 min. */
export function dayEvents(from: number, lat: number, lon: number): DayEvents {
  const sunH = -0.833 * RAD, moonH = 0.133 * RAD;
  const out: DayEvents = { sunrise: null, sunset: null, moonrise: null, moonset: null, moonUpper: null, moonLower: null };
  let s0 = sunAltitude(from, lat, lon) - sunH, m0 = moonAltitude(from, lat, lon);
  let slope0 = m0 - moonAltitude(from - STEP, lat, lon);
  for (let t = from + STEP; t <= from + DAY_MS; t += STEP) {
    const s1 = sunAltitude(t, lat, lon) - sunH, m1 = moonAltitude(t, lat, lon), slope1 = m1 - m0;
    const cross = (a: number, b: number) => t - STEP + (STEP * a) / (a - b);
    if (s0 < 0 && s1 >= 0) out.sunrise ??= cross(s0, s1);
    if (s0 >= 0 && s1 < 0) out.sunset ??= cross(s0, s1);
    if (m0 < moonH && m1 >= moonH) out.moonrise ??= cross(m0 - moonH, m1 - moonH);
    if (m0 >= moonH && m1 < moonH) out.moonset ??= cross(m0 - moonH, m1 - moonH);
    if (slope0 > 0 && slope1 <= 0) out.moonUpper ??= t - STEP; // the moon was highest at the last sample
    if (slope0 < 0 && slope1 >= 0) out.moonLower ??= t - STEP;
    s0 = s1;
    m0 = m1;
    slope0 = slope1;
  }
  return out;
}

export interface Period {
  kind: 'major' | 'minor';
  start: number;
  end: number;
}

/** The solunar periods of the day: major ±1 h around the moon's transits, minor ±30 min around rise and set. */
export function solunar(e: DayEvents): Period[] {
  const around = (t: number | null, kind: Period['kind'], half: number): Period[] => (t === null ? [] : [{ kind, start: t - half, end: t + half }]);
  return [
    ...around(e.moonUpper, 'major', 3_600_000), ...around(e.moonLower, 'major', 3_600_000),
    ...around(e.moonrise, 'minor', 1_800_000), ...around(e.moonset, 'minor', 1_800_000),
  ].sort((a, b) => a.start - b.start);
}

/** The next major solunar period still to come (or under way), else the day's first. */
export function bestPeriod(periods: Period[], now: number): Period | null {
  const major = periods.filter((p) => p.kind === 'major');
  return major.find((p) => p.end > now) ?? major[0] ?? null;
}
