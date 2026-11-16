import { describe, expect, it, vi } from 'vitest';
import { registerServiceWorker } from './register';

const nav = (register?: ReturnType<typeof vi.fn>) => (register ? { serviceWorker: { register } } : {}) as unknown as Navigator;

describe('registerServiceWorker', () => {
  it('registers in production', async () => {
    const register = vi.fn(async () => ({}));
    expect(await registerServiceWorker(nav(register), true, '/sw.js')).toBe(true);
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: './' });
  });

  it('skips dev builds and browsers without service workers', async () => {
    const register = vi.fn();
    expect(await registerServiceWorker(nav(register), false, '/sw.js')).toBe(false);
    expect(await registerServiceWorker(nav(), true, '/sw.js')).toBe(false);
    expect(register).not.toHaveBeenCalled();
  });

  it('logs and continues when registration fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await registerServiceWorker(nav(vi.fn(async () => { throw new Error('denied'); })), true, '/sw.js')).toBe(false);
    expect(warn).toHaveBeenCalled();
  });
});
