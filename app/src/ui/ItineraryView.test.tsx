import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Itinerary } from '../routing/itinerary';
import { ItineraryView } from './ItineraryView';

const itinerary: Itinerary = {
  stops: [
    { poi: { type: 'lock', name: 'Śluza Czersko Polskie', lat: 53.12, lon: 18.13, maxlength: 57.4, maxwidth: 9.6 }, at: 12_345, offset: 5 },
    { poi: { type: 'fuel', name: '', lat: 53.1, lon: 18.2 }, at: 20_000, offset: 150 },
    { poi: { type: 'bridge', name: '', lat: 53.0, lon: 18.3, clearance: 3.25 }, at: 30_000, offset: 2 },
  ],
  counts: { lock: 1, fuel: 1, bridge: 1 },
  minClearance: 3.25,
};

describe('ItineraryView', () => {
  it('lists stops with km, kind, name and details, and selects them', () => {
    const onSelect = vi.fn();
    render(<ItineraryView itinerary={itinerary} onSelect={onSelect} />);
    expect(screen.getByText('1 lock · 1 fuel · lowest bridge 3.3 m')).toBeTruthy();
    expect(screen.getByText('km 12.3')).toBeTruthy();
    expect(screen.getByText('57.4 × 9.6 m')).toBeTruthy();
    expect(screen.getByText('0.1 km off')).toBeTruthy();
    expect(screen.getByText('clearance 3.3 m')).toBeTruthy();
    fireEvent.click(screen.getByText('Śluza Czersko Polskie'));
    expect(onSelect).toHaveBeenCalledWith(18.13, 53.12);
  });

  it('says so when nothing is known', () => {
    render(<ItineraryView itinerary={{ stops: [], counts: {} }} onSelect={() => {}} />);
    expect(screen.getByText(/No locks, bridges or services/)).toBeTruthy();
  });

  it('omits the clearance summary when unknown', () => {
    render(<ItineraryView itinerary={{ ...itinerary, minClearance: undefined }} onSelect={() => {}} />);
    expect(screen.getByText('1 lock · 1 fuel')).toBeTruthy();
  });
});
