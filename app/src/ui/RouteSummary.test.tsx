import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Route } from '../routing/router';
import { defaultProfile } from '../routing/router';
import { RouteSummary } from './RouteSummary';

vi.mock('../data/waterways.json', async () => ({ default: [(await import('../test/waterwayFixture')).kanal] }));
vi.mock('../data/rules.json', async () => ({ default: [(await import('../test/rulesFixture')).land] }));

const route = {
  coordinates: [[0, 0], [1, 0]], distance: 1300, duration: 1680, locks: 1, unverified: 0, sea: 0, seaNoDepth: 0, offshore: 0, noMotor: 0, limits: [], downstream: 0, upstream: 0,
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

  it('offers the waterway sheets and warns where the boat does not fit', () => {
    render(
      <RouteSummary route={route} itinerary={{ stops: [], counts: {} }} profile={{ ...defaultProfile, airDraft: 5 }} back={null}
        onStart={() => {}} onStepsOpen={() => {}} onFocus={() => {}} more={<span>more</span>} />,
    );
    expect(screen.getByText('About the waterways (1)')).toBeTruthy();
    expect(screen.getByText('Kanal (A – B): air draft 5 m vs lowest bridge 4 m.')).toBeTruthy();
  });

  it('says where the route crosses waters closed to motorboats', () => {
    render(
      <RouteSummary route={{ ...route, noMotor: 1200 }} itinerary={{ stops: [], counts: {} }} profile={defaultProfile} back={null}
        onStart={() => {}} onStepsOpen={() => {}} onFocus={() => {}} more={<span>more</span>} />,
    );
    expect(screen.getByText(/motorboats are not allowed/)).toBeTruthy();
  });

  it('offers the rules of the countries on the route', () => {
    const town = { poi: { type: 'place' as const, name: 'Town', lat: 0, lon: 0, cc: 'XL' }, at: 500, offset: 0 };
    render(
      <RouteSummary route={route} itinerary={{ stops: [town], counts: {} }} profile={defaultProfile} back={null}
        onStart={() => {}} onStepsOpen={() => {}} onFocus={() => {}} more={<span>more</span>} />,
    );
    expect(screen.getByText('Rules by country (1)')).toBeTruthy();
    expect(screen.getByText('licence over 10 kW')).toBeTruthy();
  });
});
