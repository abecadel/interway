/** Phone sheet heights: a one-line peek, half the screen, nearly all of it. On desktop: open or folded. */
export type Snap = 'peek' | 'half' | 'full';
export const SNAPS: Snap[] = ['peek', 'half', 'full'];
export const PEEK_PX = 96;
export const DRAG_PX = 8;

/** Height of each snap for a screen this tall. */
export function snapHeights(screen: number): Record<Snap, number> {
  return { peek: PEEK_PX, half: Math.round(screen * 0.5), full: Math.round(screen * 0.88) };
}

/** The snap nearest to a dragged height. */
export function nearestSnap(height: number, screen: number): Snap {
  const h = snapHeights(screen);
  return SNAPS.reduce((best, s) => (Math.abs(h[s] - height) < Math.abs(h[best] - height) ? s : best), 'peek' as Snap);
}
