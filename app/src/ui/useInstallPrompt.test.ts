import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { type InstallPromptEvent, useInstallPrompt } from './useInstallPrompt';

function offer() {
  const e = new Event('beforeinstallprompt', { cancelable: true }) as InstallPromptEvent;
  e.prompt = vi.fn(async () => {});
  e.userChoice = Promise.resolve({ outcome: 'accepted' });
  return e;
}

describe('useInstallPrompt', () => {
  it('offers an install while the browser does, once', async () => {
    const { result, unmount } = renderHook(() => useInstallPrompt());
    expect(result.current).toBeNull();
    const e = offer();
    act(() => { window.dispatchEvent(e); });
    expect(e.defaultPrevented).toBe(true);
    await act(async () => { await result.current!(); });
    expect(e.prompt).toHaveBeenCalled();
    expect(result.current).toBeNull();

    act(() => { window.dispatchEvent(offer()); });
    expect(result.current).not.toBeNull();
    act(() => { window.dispatchEvent(new Event('appinstalled')); });
    expect(result.current).toBeNull();
    unmount();
    act(() => { window.dispatchEvent(offer()); }); // no listener left
  });
});
