import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { THEME_KEY, useTheme } from './useTheme';

function fakeWindow(dark: boolean | null) {
  const listeners: ((e: MediaQueryListEvent) => void)[] = [];
  const mq = {
    matches: dark ?? false,
    addEventListener: vi.fn((_: string, fn: (e: MediaQueryListEvent) => void) => listeners.push(fn)),
    removeEventListener: vi.fn(),
  };
  const win = { document, matchMedia: dark === null ? undefined : vi.fn(() => mq) } as unknown as Window;
  return { win, mq, change: (m: boolean) => listeners.forEach((fn) => fn({ matches: m } as MediaQueryListEvent)) };
}

describe('useTheme', () => {
  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    vi.restoreAllMocks();
  });

  it('follows the system until the user chooses, and remembers the choice', () => {
    const { win, mq, change } = fakeWindow(false);
    const { result, unmount } = renderHook(() => useTheme(win));
    expect(result.current).toMatchObject({ theme: 'auto', night: false });
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    act(() => change(true));
    expect(result.current.night).toBe(true);
    act(() => result.current.setTheme('day'));
    expect(result.current.night).toBe(false);
    expect(document.documentElement.getAttribute('data-theme')).toBe('day');
    expect(localStorage.getItem(THEME_KEY)).toBe('day');
    act(() => result.current.setTheme('night'));
    expect(result.current.night).toBe(true);
    unmount();
    expect(mq.removeEventListener).toHaveBeenCalled();
    expect(renderHook(() => useTheme(win)).result.current.theme).toBe('night');
  });

  it('works without matchMedia or storage', () => {
    localStorage.setItem(THEME_KEY, 'bogus');
    const { win } = fakeWindow(null);
    expect(renderHook(() => useTheme(win)).result.current).toMatchObject({ theme: 'auto', night: false });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    const { result } = renderHook(() => useTheme(win));
    expect(result.current.theme).toBe('auto');
    act(() => result.current.setTheme('night'));
    expect(result.current.night).toBe(true);
  });

  it('uses the real window by default', () => {
    expect(renderHook(() => useTheme()).result.current.theme).toBe('auto');
  });
});
