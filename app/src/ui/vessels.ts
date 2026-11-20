import { defaultProfile, type VesselProfile } from '../routing/router';

type Hull = Pick<VesselProfile, 'speedKmh' | 'draft' | 'airDraft' | 'beam' | 'length'>;

/** Boat types offered as chips; each sets speed and dimensions, the rest of the profile stays. */
export const VESSELS: { id: string; label: string; hull: Hull }[] = [
  { id: 'small', label: 'Small boat', hull: { speedKmh: defaultProfile.speedKmh, draft: defaultProfile.draft, airDraft: defaultProfile.airDraft, beam: defaultProfile.beam, length: defaultProfile.length } },
  { id: 'motorboat', label: 'Motor cruiser', hull: { speedKmh: 12, draft: 1.2, airDraft: 3.5, beam: 3.5, length: 11 } },
  // mast up: for sea passages; bridges inland need it lowered (choose Custom and set the air draft)
  { id: 'sailboat', label: 'Sailboat', hull: { speedKmh: 10, draft: 1.8, airDraft: 15, beam: 3.5, length: 11 } },
  { id: 'narrowboat', label: 'Narrowboat', hull: { speedKmh: 6, draft: 0.7, airDraft: 2.0, beam: 2.08, length: 18 } },
];

/** The preset the profile matches, if any. */
export function vesselOf(p: VesselProfile): string | null {
  return VESSELS.find((v) => (Object.keys(v.hull) as (keyof Hull)[]).every((k) => p[k] === v.hull[k]))?.id ?? null;
}
