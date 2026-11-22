import { haversine, type LngLat } from '../graph/geo';
import data from '../data/ports.json';

/** Researched facts about a major marina or harbour (format: the port sheet brief); null when no source says. */
export interface PortSheet {
  id: string;
  name: string;
  aliases: string[];
  country: string;
  position: LngLat;
  kind: string;
  berths: number | null;
  visitorBerths: number | null;
  maxLengthM: number | null;
  depthM: number | null;
  vhf: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  booking: string | null;
  fuel: string | null;
  facilities: string[];
  fees: string | null;
  season: string | null;
  approach: string | null;
  notes: string | null;
  sources: string[];
  checked: string;
}

export const PORTS = data as unknown as PortSheet[];

/** metres within which a tapped place is taken to be the sheet's port */
export const PORT_NEAR_M = 600;

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** The port sheet for a place: the nearest within PORT_NEAR_M, or one named like the place within 3 km
 *  (a large harbour is tapped far from its sheet's point). */
export function portSheetFor(position: LngLat, label: string, ports: PortSheet[] = PORTS): PortSheet | null {
  let best: PortSheet | null = null;
  let bestD = Infinity;
  const name = fold(label);
  for (const p of ports) {
    const d = haversine(position[1], position[0], p.position[1], p.position[0]);
    const named = name !== '' && [p.name, ...p.aliases].some((n) => fold(n) === name);
    if ((d <= PORT_NEAR_M || (named && d <= 3000)) && d < bestD) {
      best = p;
      bestD = d;
    }
  }
  return best;
}
