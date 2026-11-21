import { describe, expect, it } from 'vitest';
import { addCatch, CATCH_KEY, catchesCsv, catchesGeoJson, catchesGpx, loadCatches, removeCatch } from './catches';

const base = { time: '2026-11-21T10:00:00.000Z', position: [21.6, 53.8] as [number, number], place: 'Mikołajki', species: 'Pike' };

describe('my catches', () => {
  it('are kept in this browser and removed again', () => {
    localStorage.clear();
    expect(loadCatches()).toEqual([]);
    let list = addCatch([], { ...base, lengthCm: 72, released: true }, localStorage, 'a');
    list = addCatch(list, { ...base, species: 'Zander, "big"', weightKg: 2.4, released: false, notes: 'at dusk\non a jig' }, localStorage, 'b');
    expect(loadCatches().map((c) => c.id)).toEqual(['b', 'a']);
    expect(removeCatch(list, 'b').map((c) => c.id)).toEqual(['a']);
    expect(loadCatches().map((c) => c.id)).toEqual(['a']);
    expect(addCatch([], base).at(0)!.id).toMatch(/^[a-z0-9]+$/);
  });

  it('read nothing bad from storage, and survive storage that refuses', () => {
    localStorage.setItem(CATCH_KEY, '{');
    expect(loadCatches()).toEqual([]);
    localStorage.setItem(CATCH_KEY, JSON.stringify([{ species: 1 }, { ...base }, 'x']));
    expect(loadCatches()).toHaveLength(1);
    localStorage.setItem(CATCH_KEY, '{"a":1}');
    expect(loadCatches()).toEqual([]);
    const full = { getItem: () => null, setItem: () => { throw new Error('quota'); } } as unknown as Storage;
    expect(addCatch([], base, full, 'z')).toHaveLength(1);
  });

  it('export as CSV, GPX and GeoJSON', () => {
    const list = [{ id: 'a', ...base, lengthCm: 72, released: true }, { id: 'b', ...base, species: 'Zander, "big"', weightKg: 2.4, released: false, notes: 'x<y' }, { id: 'c', ...base }];
    const csv = catchesCsv(list).split('\n');
    expect(csv[0]).toBe('time,species,length_cm,weight_kg,released,place,lon,lat,conditions,notes');
    expect(csv[1]).toBe('2026-11-21T10:00:00.000Z,Pike,72,,yes,Mikołajki,21.6,53.8,,');
    expect(csv[2]).toBe('2026-11-21T10:00:00.000Z,"Zander, ""big""",,2.4,no,Mikołajki,21.6,53.8,,x<y');
    expect(csv[3]).toBe('2026-11-21T10:00:00.000Z,Pike,,,,Mikołajki,21.6,53.8,,');
    const gpx = catchesGpx(list);
    expect(gpx).toContain('<wpt lat="53.800000" lon="21.600000"><time>2026-11-21T10:00:00.000Z</time><name>Pike</name><desc>72 cm, Mikołajki</desc></wpt>');
    expect(gpx).toContain('<desc>2.4 kg, Mikołajki, x&lt;y</desc>');
    const gj = JSON.parse(catchesGeoJson(list));
    expect(gj.features[0]).toEqual({ type: 'Feature', properties: { id: 'a', time: base.time, place: 'Mikołajki', species: 'Pike', lengthCm: 72, released: true }, geometry: { type: 'Point', coordinates: [21.6, 53.8] } });
  });
});
