import { describe, expect, it } from 'vitest';
import { SAMPLE } from './ports.fixture';
import { PORTS, portSheetFor, type PortSheet } from './ports';


describe('portSheetFor', () => {
  const far: PortSheet = { ...SAMPLE, id: 'far', name: 'Far', aliases: [], position: [16.5, 43.5] };
  it('takes the nearest sheet within reach', () => {
    expect(portSheetFor([16.434, 43.5032], 'Pontoon', [far, SAMPLE])!.id).toBe('hr-split-aci');
    expect(portSheetFor([16.46, 43.503], 'Pontoon', [SAMPLE])).toBeNull();
  });
  it('matches a larger harbour by name, accents and case aside', () => {
    expect(portSheetFor([16.455, 43.503], 'aci split', [SAMPLE])!.id).toBe('hr-split-aci');
    expect(portSheetFor([16.455, 43.503], '', [SAMPLE])).toBeNull();
    expect(portSheetFor([16.6, 43.503], 'ACI Split', [SAMPLE])).toBeNull();
  });
  it('keeps the nearer of two', () => {
    const near = { ...SAMPLE, id: 'near', position: [16.4338, 43.503] as [number, number] };
    expect(portSheetFor([16.4338, 43.503], 'x', [SAMPLE, near, far])!.id).toBe('near');
  });
  it('ships well-formed sheets', () => {
    for (const p of PORTS) {
      expect(Object.keys(p).sort()).toEqual(Object.keys(SAMPLE).sort());
      expect(p.position).toHaveLength(2);
    }
  });
});
