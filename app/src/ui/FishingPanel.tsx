import { type ReactNode, useState } from 'react';
import type { LngLat } from '../graph/geo';
import { dayEvents, moonPhase, solunar } from './astro';
import type { Catch } from './catches';
import { compass, type Conditions, fetchConditions, trendText } from './conditions';

const hm = (t: number | null) => (t === null ? '—' : new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));

/** The day here for an angler: sun, moon and solunar periods (on the device), weather and sea on request, a catch
 *  to log, and the fishing rules of the country. */
export function FishingPanel({ position, label, rules, onLog, now: given, fetchFn }: {
  position: LngLat;
  label: string;
  /** "Fishing rules here", when the place's country is known */
  rules?: ReactNode;
  onLog: (c: Omit<Catch, 'id'>) => void;
  now?: number;
  fetchFn?: (url: string) => Promise<Response>;
}) {
  const [opened] = useState(() => Date.now()); // the clock when the panel opened: stable across renders
  const now = given ?? opened;
  const [lon, lat] = position;
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const day = dayEvents(midnight.getTime(), lat, lon);
  const moon = moonPhase(now);
  const periods = solunar(day);
  const [weather, setWeather] = useState<Conditions | 'loading' | string | null>(null);
  const [form, setForm] = useState(false);
  const loadWeather = () => {
    setWeather('loading');
    fetchConditions(lat, lon, fetchFn).then(setWeather, (e: Error) => setWeather(e.message));
  };
  const w = typeof weather === 'object' ? weather : null;
  const summary = [`moon ${moon.name}`, w && `wind ${Math.round(w.windKn)} kn ${compass(w.windFrom)}`, w && `${Math.round(w.pressureHpa)} hPa ${trendText(w.pressureTrend) ?? ''}`.trim()]
    .filter(Boolean).join(', ');
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const num = (k: string) => (f.get(k) ? Number(f.get(k)) : undefined);
    onLog({
      time: new Date(now).toISOString(), position, place: label, species: String(f.get('species') || 'unknown'),
      lengthCm: num('length'), weightKg: num('weight'), released: f.get('released') === 'on', notes: String(f.get('notes') || '') || undefined,
      conditions: summary,
    });
    setForm(false);
  };
  return (
    <section className="fishing" aria-label="Fishing">
      <h3>Fishing here today</h3>
      <dl className="facts small">
        <div><dt>Sun</dt><dd>rises {hm(day.sunrise)}, sets {hm(day.sunset)}</dd></div>
        <div><dt>Moon</dt><dd>{moon.name}, {Math.round(moon.fraction * 100)}% lit; rises {hm(day.moonrise)}, sets {hm(day.moonset)}</dd></div>
        <div>
          <dt>Solunar</dt>
          <dd>{periods.map((p) => `${p.kind} ${hm(p.start)}–${hm(p.end)}`).join(', ')}</dd>
        </div>
        {w && (
          <>
            <div><dt>Wind</dt><dd>{Math.round(w.windKn)} kn from {compass(w.windFrom)}, gusts {Math.round(w.gustKn)} kn</dd></div>
            <div><dt>Pressure</dt><dd>{Math.round(w.pressureHpa)} hPa{w.pressureTrend !== null && `, ${trendText(w.pressureTrend)}`}</dd></div>
            <div><dt>Air</dt><dd>{Math.round(w.airC)} °C</dd></div>
            {(w.waveM !== null || w.seaC !== null) && (
              <div><dt>Sea</dt><dd>{[w.waveM !== null && `waves ${w.waveM} m`, w.seaC !== null && `water ${Math.round(w.seaC)} °C`].filter(Boolean).join(', ')}</dd></div>
            )}
          </>
        )}
      </dl>
      {weather === 'loading' && <p className="info small">Getting the weather…</p>}
      {typeof weather === 'string' && weather !== 'loading' && <p className="error small">{weather}</p>}
      <div className="action-row">
        {!w && <button type="button" className="pill" onClick={loadWeather}>Weather and sea now</button>}
        <button type="button" className="pill" aria-expanded={form} onClick={() => setForm(!form)}>Log a catch here</button>
      </div>
      {form && (
        <form className="catch-form" onSubmit={submit}>
          <label>Species<input name="species" required /></label>
          <label>Length (cm)<input name="length" type="number" min="0" step="0.5" /></label>
          <label>Weight (kg)<input name="weight" type="number" min="0" step="0.01" /></label>
          <label className="check"><input name="released" type="checkbox" />Released</label>
          <label>Notes<input name="notes" /></label>
          <button type="submit" className="pill primary">Save to my catches</button>
          <p className="small muted">Kept only in this browser. Reporting a sea catch where the law asks for it (the EU's RecFishing app) is separate.</p>
        </form>
      )}
      {rules}
      <p className="small muted">Times on this device's clock. Sun and moon computed here; weather from Open-Meteo.com (CC BY 4.0) when asked.</p>
    </section>
  );
}
