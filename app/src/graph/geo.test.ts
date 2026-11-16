import { describe, expect, it } from 'vitest';
import { haversine, projectOnSegment } from './geo';

describe('geo', () => {
  it('haversine: one degree of latitude is ~111 km', () => {
    expect(haversine(52, 21, 53, 21)).toBeCloseTo(111_195, -2);
    expect(haversine(52, 21, 52, 21)).toBe(0);
  });

  it('projects onto the inside of a segment', () => {
    const r = projectOnSegment(52.001, 21.005, 52, 21, 52, 21.01);
    expect(r.t).toBeCloseTo(0.5, 3);
    expect(r.lat).toBeCloseTo(52, 6);
    expect(r.dist).toBeCloseTo(111, 0);
  });

  it('clamps beyond the ends', () => {
    expect(projectOnSegment(52, 20.9, 52, 21, 52, 21.01).t).toBe(0);
    expect(projectOnSegment(52, 21.5, 52, 21, 52, 21.01).t).toBe(1);
  });

  it('handles a zero-length segment', () => {
    const r = projectOnSegment(52.01, 21, 52, 21, 52, 21);
    expect(r.t).toBe(0);
    expect(r.dist).toBeCloseTo(1112, -1);
  });
});
