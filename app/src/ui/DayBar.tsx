import { bestPeriod, type DayEvents, type Period } from './astro';

const DAY = 86_400_000;
const W = 240;

const hm = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** The day from 00 to 24: daylight, the solunar periods (major darker), and a line at now. */
export function DayBar({ midnight, day, periods, now, daylight }: {
  midnight: number;
  day: DayEvents;
  periods: Period[];
  now: number;
  /** with neither sunrise nor sunset: is it light all day (midnight sun) or dark (polar night)? */
  daylight: boolean;
}) {
  const x = (t: number) => Math.max(0, Math.min(W, ((t - midnight) / DAY) * W));
  const rise = day.sunrise ?? (day.sunset !== null || daylight ? midnight : null);
  const set = day.sunset ?? (rise !== null ? midnight + DAY : null);
  const best = bestPeriod(periods, now);
  return (
    <div className="day-bar">
      {best && <div className="small"><b>Best:</b> {hm(best.start)}–{hm(best.end)}</div>}
      <svg viewBox={`0 0 ${W} 30`} role="img" aria-label="Daylight and solunar periods today" preserveAspectRatio="none">
        <rect x="0" y="4" width={W} height="16" rx="4" className="night" />
        {rise !== null && set !== null && <rect x={x(rise)} y="4" width={Math.max(0, x(set) - x(rise))} height="16" className="day" />}
        {periods.map((p, i) => <rect key={i} x={x(p.start)} y="6" width={Math.max(1, x(p.end) - x(p.start))} height="12" rx="2" className={p.kind} />)}
        {now >= midnight && now < midnight + DAY && <rect x={x(now) - 1} y="0" width="2" height="24" className="now" />}
      </svg>
      <div className="day-hours small muted"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>
    </div>
  );
}
