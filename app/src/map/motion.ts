// Small animations, all skipped when the user asks for reduced motion.
import type { ExpressionSpecification } from 'maplibre-gl';

export function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Calls `step` with eased progress 0..1 on each frame for `ms`; returns a cancel function. With reduced motion,
 *  one call with 1. */
export function tween(ms: number, step: (t: number) => void, raf: (f: FrameRequestCallback) => number = requestAnimationFrame,
  caf: (id: number) => void = cancelAnimationFrame): () => void {
  if (reducedMotion()) {
    step(1);
    return () => {};
  }
  let begin: number | null = null;
  let id = 0;
  const frame = (now: number) => {
    begin ??= now;
    const t = Math.min(1, (now - begin) / ms);
    step(1 - (1 - t) ** 3); // ease-out
    if (t < 1) id = raf(frame);
  };
  id = raf(frame);
  return () => caf(id);
}

/** a line drawn up to `t` of its length (MapLibre line-gradient over line-progress) */
export function drawnTo(color: string, t: number): ExpressionSpecification {
  return t >= 1 ? ['interpolate', ['linear'], ['line-progress'], 0, color, 1, color]
    : ['step', ['line-progress'], color, Math.max(t, 1e-6), 'rgba(0,0,0,0)'];
}
