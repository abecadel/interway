import { describe, expect, it } from 'vitest';
import { NOTICES, noticesFor } from './notices';

describe('notices to skippers', () => {
  it('lists each known country once, in route order', () => {
    expect(noticesFor(['PL', 'DE', 'PL', 'XX', 'FR']).map((n) => n.cc)).toEqual(['PL', 'DE', 'FR']);
    expect(noticesFor([])).toEqual([]);
    for (const n of Object.values(NOTICES)) expect(n.url).toMatch(/^https:\/\//);
  });
});
