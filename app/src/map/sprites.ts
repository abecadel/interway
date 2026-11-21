// Map symbols: a white glyph on a coloured badge per kind of place. The shape says what kind of thing it is:
// round for services, a rounded square for structures you pass (lock, bridge, fish farm), a diamond for hazards.
// Drawn from inline SVG at twice the size, so they stay sharp on phone screens.
import type { PoiType } from '../routing/service';

type Shape = 'circle' | 'square' | 'diamond';
type Kind = Exclude<PoiType, 'place'>;

interface Badge {
  color: string;
  shape: Shape;
  /** SVG content on a 24 × 24 grid, stroked in the glyph colour */
  glyph: string;
  /** a dark glyph on a light badge */
  ink?: string;
}

const p = (d: string) => `<path d="${d}"/>`;

export const BADGES: Record<Kind, Badge> = {
  marina: { color: '#1d6fd8', shape: 'circle', glyph: p('M22 18H2a4 4 0 0 0 4 4h12a4 4 0 0 0 4-4Z') + p('M21 14 10 2 3 14h18Z') + p('M10 2v16') },
  port: { color: '#0b3d91', shape: 'circle', glyph: p('M12 22V8') + p('M5 12H2a10 10 0 0 0 20 0h-3') + '<circle cx="12" cy="5" r="3"/>' },
  lock: { color: '#e0a100', shape: 'square', ink: '#1b1b1b', glyph: p('M5 3v18M19 3v18') + p('M5 7l7 4 7-4M5 17l7-4 7 4') },
  bridge: { color: '#8d6e3f', shape: 'square', glyph: p('M2 8h20M5 8v12M19 8v12') + p('M5 18a7 7 0 0 1 14 0') },
  fuel: {
    color: '#c2185b', shape: 'circle',
    glyph: p('M3 22h12M4 9h10') + p('M14 22V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18') + p('M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 4 0V9.8a2 2 0 0 0-.6-1.4L18 5'),
  },
  water: { color: '#0288d1', shape: 'circle', glyph: p('M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7Z') },
  sanitary: { color: '#6a4fd6', shape: 'circle', glyph: p('M12 3v9M8 8l4 4 4-4') + p('M5 15h14v6H5Z') },
  slipway: { color: '#2e8b3e', shape: 'circle', glyph: p('M3 16 21 6') + p('M2 21c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2') },
  fishing: { color: '#00897b', shape: 'circle', glyph: p('M15 5v10a5 5 0 0 1-10 0v-3l3 3') + '<circle cx="15" cy="3.5" r="1.5"/>' },
  tackle: { color: '#795548', shape: 'circle', glyph: p('M3 21 19 5M19 5v12') + p('M16 17h6') },
  fishfarm: { color: '#7a8a12', shape: 'square', glyph: '<circle cx="12" cy="12" r="8"/>' + p('M4 12h16M12 4v16') },
  wreck: { color: '#c62828', shape: 'diamond', glyph: p('M3 14h18l-3 5H6Z') + p('M12 14V4l5 5') },
  obstruction: { color: '#c62828', shape: 'diamond', glyph: p('M12 3 2 20h20Z') + p('M12 9v5M12 17h.01') },
};

/** importance on the map: lower is placed first when symbols collide */
export const SORT: Record<string, number> = { lock: 0, bridge: 1, obstruction: 1, wreck: 2, port: 2, marina: 3, fuel: 3 };
export const SORT_DEFAULT = 5;

const SIZE = 26; // logical pixels
const SCALE = 2;

const outline = (s: Shape, fill: string) => {
  const a = `fill="${fill}" stroke="#fff" stroke-width="2"`;
  if (s === 'circle') return `<circle cx="13" cy="13" r="12" ${a}/>`;
  if (s === 'square') return `<rect x="1" y="1" width="24" height="24" rx="6" ${a}/>`;
  return `<path d="M13 0.5 25.5 13 13 25.5 0.5 13Z" ${a}/>`;
};

/** the badge as an SVG document */
export function badgeSvg(kind: Kind): string {
  const b = BADGES[kind];
  // a diamond has less room inside: a smaller glyph
  const g = b.shape === 'diamond' ? 12 : 15;
  const off = (SIZE - g) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE * SCALE}" height="${SIZE * SCALE}" viewBox="0 0 ${SIZE} ${SIZE}">`
    + outline(b.shape, b.color)
    + `<g transform="translate(${off} ${off}) scale(${g / 24})" fill="none" stroke="${b.ink ?? '#fff'}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">`
    + `${b.glyph}</g></svg>`;
}

export const imageId = (kind: string) => `poi-${kind}`;

/** the badge as an image URL, for the same symbol in the sheet as on the map */
export const badgeUrl = (kind: Kind) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(badgeSvg(kind))}`;

type Img = HTMLImageElement;
const loaded = new Map<string, Img>();
const waiting = new Set<() => void>();
let started = false;

/** Starts decoding every badge (once); `onReady` runs as each one is ready, to add it to the map.
 *  Returns the function that stops listening. */
export function loadBadges(onReady: () => void, make: () => Img = () => new Image()): () => void {
  waiting.add(onReady);
  if (!started) {
    started = true;
    for (const kind of Object.keys(BADGES) as Kind[]) {
      const img = make();
      img.onload = () => {
        loaded.set(imageId(kind), img);
        for (const f of waiting) f();
      };
      img.src = badgeUrl(kind);
    }
  }
  return () => waiting.delete(onReady);
}

/** Adds the badges decoded so far to the map's style (a new style starts without them). */
export function addBadges(map: { hasImage(id: string): boolean; addImage(id: string, img: Img, o: { pixelRatio: number }): void }) {
  for (const [id, img] of loaded) if (!map.hasImage(id)) map.addImage(id, img, { pixelRatio: SCALE });
}

/** for tests: forget the decoded badges */
export function resetBadges() {
  loaded.clear();
  waiting.clear();
  started = false;
}
