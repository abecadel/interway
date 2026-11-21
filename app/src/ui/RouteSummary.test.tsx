import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Route } from '../routing/router';
import { defaultProfile } from '../routing/router';
import { RouteSummary } from './RouteSummary';

const route = {
  coordinates: [[0, 0], [1, 0]], distance: 1300, duration: 1680, locks: 1, unverified: 0, sea: 0, seaNoDepth: 0, offshore: 0, downstream: 0, upstream: 0,
  tooShallow: 0, shallowest: null, events: [], legs: [{ name: 'Kanal', distance: 1300 }],
  start: { geom: 0, seg: 0, lat: 0, lon: 0, offset: 0, frac: 0 }, end: { geom: 0, seg: 0, lat: 0, lon: 1, offset: 0, frac: 0 },
} as Route;

describe('RouteSummary', () => {
  it('counts one lock, and opens and closes the steps', () => {
    const onStepsOpen = vi.fn();
    render(
      <RouteSummary route={route} itinerary={{ stops: [], counts: {} }} profile={defaultProfile} back={null}
        onStart={() => {}} onStepsOpen={onStepsOpen} onFocus={() => {}} more={<span>more</span>} />,
    );
    expect(screen.getByText(/· 1 lock ·/)).toBeTruthy();
    fireEvent.click(screen.getByText('Steps'));
    expect(screen.getByText('Kanal')).toBeTruthy();
    fireEvent.click(screen.getByText('Steps'));
    expect(screen.queryByText('Kanal')).toBeNull();
    expect(onStepsOpen).toHaveBeenCalledTimes(1);
  });
});
