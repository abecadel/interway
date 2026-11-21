import { afterEach, describe, expect, it, vi } from 'vitest';
import { drawnTo, reducedMotion, tween } from './motion';

const media = (reduce: boolean) => vi.stubGlobal('matchMedia', (q: string) => ({ matches: reduce && q.includes('reduce') }));

afterEach(() => vi.unstubAllGlobals());

describe('motion', () => {
  it('knows when the user asked for less motion', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(reducedMotion()).toBe(false);
    media(true);
    expect(reducedMotion()).toBe(true);
  });

  it('eases from 0 to 1 over the frames, and can be cancelled', () => {
    media(false);
    const frames: FrameRequestCallback[] = [];
    let n = 0;
    const raf = (f: FrameRequestCallback) => { frames.push(f); return ++n; };
    const caf = vi.fn();
    const seen: number[] = [];
    const cancel = tween(100, (t) => seen.push(t), raf, caf);
    frames.shift()!(1000);
    frames.shift()!(1050);
    frames.shift()!(1200);
    expect(seen).toEqual([0, 1 - 0.5 ** 3, 1]);
    expect(frames).toHaveLength(0);
    cancel();
    expect(caf).toHaveBeenCalledWith(3);
  });

  it('jumps to the end with reduced motion', () => {
    media(true);
    const step = vi.fn();
    tween(100, step)();
    expect(step).toHaveBeenCalledWith(1);
  });

  it('draws a line up to a fraction of its length', () => {
    expect(drawnTo('#00f', 0)).toEqual(['step', ['line-progress'], '#00f', 1e-6, 'rgba(0,0,0,0)']);
    expect(drawnTo('#00f', 0.5)[3]).toBe(0.5);
    expect(drawnTo('#00f', 1)).toEqual(['interpolate', ['linear'], ['line-progress'], 0, '#00f', 1, '#00f']);
  });
});
