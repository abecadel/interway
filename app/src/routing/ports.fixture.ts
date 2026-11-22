import type { PortSheet } from './ports';

/** A port sheet for tests. */
export const SAMPLE: PortSheet = {
  id: 'hr-split-aci', name: 'ACI Marina Split', aliases: ['ACI Split'], country: 'HR', position: [16.4337, 43.503], kind: 'marina',
  berths: 355, visitorBerths: 50, maxLengthM: 40, depthM: 4.5, vhf: '17', phone: '+385 21 398 599', email: 'm.split@aci-club.hr',
  website: 'aci-marinas.com', booking: 'https://booking.example/split', fuel: 'diesel, petrol', facilities: ['water', 'showers'],
  fees: '€120/night', season: 'all year', approach: 'Between the breakwaters.', notes: 'Book ahead.', sources: ['https://aci-marinas.com/split'],
  checked: '2026-11-22',
};
