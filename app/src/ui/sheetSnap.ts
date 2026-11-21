/** Phone sheet heights: a one-line peek, half the screen, nearly all of it. On desktop: open or folded. */
export type Snap = 'peek' | 'half' | 'full';
export const SNAPS: Snap[] = ['peek', 'half', 'full'];
export const PEEK_PX = 72;
export const DRAG_PX = 8;

/** Height of each snap for a screen this tall. */
export function snapHeights(screen: number): Record<Snap, number> {
  return { peek: PEEK_PX, half: Math.round(screen * 0.5), full: Math.round(screen * 0.88) };
}

/** how far ahead a fling carries the sheet: its speed over this long */
export const FLING_S = 0.2;

/** The snap nearest to where a dragged sheet is heading: its height, plus its speed (px/s, up is positive)
 *  carried on for FLING_S, so a flick goes on to the next snap. */
export function nearestSnap(height: number, screen: number, velocity = 0): Snap {
  const h = snapHeights(screen);
  const aim = height + velocity * FLING_S;
  return SNAPS.reduce((best, s) => (Math.abs(h[s] - aim) < Math.abs(h[best] - aim) ? s : best), 'peek' as Snap);
}

/** Past the lowest or highest snap the sheet still follows the finger, but less and less (a rubber band). */
export function rubberBand(height: number, min: number, max: number): number {
  const give = (over: number) => 40 * (1 - 1 / (1 + over / 120));
  if (height < min) return min - give(min - height);
  if (height > max) return max + give(height - max);
  return height;
}
