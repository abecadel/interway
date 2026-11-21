import { describe, expect, it } from 'vitest';
import type { Route } from '../routing/router';
import { optionName, timeDiff } from './routeOptions';

const r = (legs: [string, number][]) => ({ legs: legs.map(([name, distance]) => ({ name, distance })) }) as Route;

describe('route options', () => {
  it('names an alternative after its longest waterway the best route does not use', () => {
    const opts = [r([['Pisa', 10], ['Lake', 5]]), r([['Pisa', 10], ['Short cut', 2], ['Mikołajki channel', 8], ['', 30]]), r([['Pisa', 3]])];
    expect(optionName(opts, 0)).toBe('Best');
    expect(optionName(opts, 1)).toBe('Via Mikołajki channel');
    expect(optionName(opts, 2)).toBe('Option 3');
  });

  it('labels the time difference', () => {
    expect(timeDiff(1620)).toBe('+27 min');
    expect(timeDiff(-3600)).toBe('−1 h 0 min');
  });
});
