import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useMediaQuery } from './useMediaQuery';

describe('useMediaQuery', () => {
  it('follows the query and stops listening on unmount', () => {
    let fire: (e: MediaQueryListEvent) => void = () => {};
    const mq = { matches: true, addEventListener: vi.fn((_: string, f: typeof fire) => { fire = f; }), removeEventListener: vi.fn() };
    const win = { matchMedia: vi.fn(() => mq) } as unknown as Window;
    const { result, unmount } = renderHook(() => useMediaQuery('(x)', win));
    expect(result.current).toBe(true);
    act(() => fire({ matches: false } as MediaQueryListEvent));
    expect(result.current).toBe(false);
    unmount();
    expect(mq.removeEventListener).toHaveBeenCalled();
  });

  it('is false without matchMedia', () => {
    expect(renderHook(() => useMediaQuery('(x)', {} as Window)).result.current).toBe(false);
    expect(renderHook(() => useMediaQuery('(x)')).result.current).toBe(false);
  });
});
