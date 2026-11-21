import { describe, expect, it } from 'vitest';
import type { Poi } from '../routing/service';
import { portFacts } from './portFacts';

const base: Poi = { type: 'marina', name: 'Port', lat: 0, lon: 0 };

describe('port facts', () => {
  it('lists what is known, with units and links', () => {
    expect(portFacts({ ...base, services: 'diesel, water', berths: '120', boatlength: '15', depth: '2,5', vhf: '9', hours: 'Mo-Su 08:00-20:00',
      phone: '+33 4 93 00 00 00', email: 'port@x.example', website: 'https://www.port.example/', operator: 'Ville' })).toEqual([
      { label: 'Services', value: 'diesel, water' },
      { label: 'Berths', value: '120' },
      { label: 'Boats up to', value: '15 m' },
      { label: 'Depth', value: '2,5 m' },
      { label: 'VHF', value: 'channel 9' },
      { label: 'Hours', value: 'Mo-Su 08:00-20:00' },
      { label: 'Phone', value: '+33 4 93 00 00 00', href: 'tel:+33493000000' },
      { label: 'E-mail', value: 'port@x.example', href: 'mailto:port@x.example' },
      { label: 'Website', value: 'port.example', href: 'https://www.port.example/' },
      { label: 'Operator', value: 'Ville' },
    ]);
  });

  it('keeps free text as written and adds a scheme to bare websites', () => {
    expect(portFacts({ ...base, vhf: '9;16', depth: '3 m at the quay', website: 'port.example' })).toEqual([
      { label: 'Depth', value: '3 m at the quay' },
      { label: 'VHF', value: '9;16' },
      { label: 'Website', value: 'port.example', href: 'https://port.example' },
    ]);
    expect(portFacts(base)).toEqual([]);
  });
});
