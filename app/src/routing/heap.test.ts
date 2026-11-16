import { describe, expect, it } from 'vitest';
import { MinHeap } from './heap';

describe('MinHeap', () => {
  it('pops ids in key order, including duplicates', () => {
    const h = new MinHeap();
    const keys = [5, 3, 8, 1, 9, 2, 7, 3, 6, 0];
    keys.forEach((k, i) => h.push(i, k));
    expect(h.size).toBe(keys.length);
    const out: number[] = [];
    while (h.size) out.push(keys[h.pop()]);
    expect(out).toEqual([...keys].sort((a, b) => a - b));
  });

  it('works with a single element', () => {
    const h = new MinHeap();
    h.push(42, 1);
    expect(h.pop()).toBe(42);
    expect(h.size).toBe(0);
  });
});
