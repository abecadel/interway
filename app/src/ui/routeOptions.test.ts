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

  it('names two waterways when the second is long too, and keeps the names apart', () => {
    const best = r([['Saint Lawrence Seaway', 300]]);
    const rideau = r([['Ottawa River / Rivière des Outaouais', 100], ['Rideau River', 50], ['Rideau River', 40], ['Tiny cut', 5]]);
    const other = r([['Ottawa River / Rivière des Outaouais', 110], ['Rideau River', 80], ['Lac des Deux-Montagnes', 26]]);
    const same = r([['Ottawa River', 100], ['Rideau River', 60]]);
    const opts = [best, rideau, other, same];
    expect(optionName(opts, 1)).toBe('Via Ottawa River and Rideau River');
    expect(optionName(opts, 2)).toBe('Via Lac des Deux-Montagnes');
    expect(optionName(opts, 3)).toBe('Option 4');
  });

  it('labels the time difference', () => {
    expect(timeDiff(1620)).toBe('+27 min');
    expect(timeDiff(-3600)).toBe('−1 h 0 min');
  });
});
