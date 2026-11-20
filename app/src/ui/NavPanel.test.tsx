import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Progress } from '../nav/progress';
import type { Navigation } from '../nav/useNavigation';
import { NavPanel } from './NavPanel';

const nav = (over: Partial<Navigation> = {}): Navigation => ({
  active: true, follow: true, progress: null, motion: null, rerouting: false, error: null,
  start: vi.fn(), stop: vi.fn(), setFollow: vi.fn(), voice: false, setVoice: vi.fn(), track: [], clearTrack: vi.fn(), ...over,
});
const progress = (over: Partial<Progress> = {}): Progress => ({
  time: new Date(2026, 5, 1, 10, 0).getTime(), along: 1000, crossTrack: 42, side: 'left', remaining: 12_500, eta: 3600, offCount: 0, offRoute: false, arrived: false,
  next: { kind: 'lock', name: 'Schleuse Lehnitz', at: 4200, distance: 3200 },
  upcoming: [
    { kind: 'lock', name: 'Schleuse Lehnitz', at: 4200, distance: 3200 },
    { kind: 'bridge', name: '', at: 6000, distance: 5000 },
    { kind: 'end', name: '', at: 13_500, distance: 12_500 },
  ],
  ...over,
});

describe('NavPanel', () => {
  it('waits for GPS', () => {
    render(<NavPanel nav={nav()} />);
    expect(screen.getByText('Waiting for GPS…')).toBeTruthy();
    expect(screen.getAllByText('–')).toHaveLength(4);
  });

  it('shows the next events, speed, course, cross-track error and arrival time', () => {
    render(<NavPanel nav={nav({ progress: progress(), motion: { sog: 2, cog: 7 } })} />);
    expect(screen.getByText('Schleuse Lehnitz', { exact: false }).textContent).toContain('Lock Schleuse Lehnitz in 3.2 km');
    expect(screen.getByText('then Bridge in 5.0 km')).toBeTruthy();
    expect(screen.getByText('then Destination in 13 km')).toBeTruthy();
    expect(screen.getByText('3.9 kn')).toBeTruthy();
    expect(screen.getByText('7.2 km/h')).toBeTruthy();
    expect(screen.getByText('007°')).toBeTruthy();
    expect(screen.getByText('42 m')).toBeTruthy();
    expect(screen.getByText('left of route')).toBeTruthy();
    expect(screen.getByText('1 h 0 min')).toBeTruthy();
    expect(screen.getByText(/13 km · 11:00/)).toBeTruthy();
    expect(screen.queryByText('Recenter')).toBeNull();
  });

  it('toggles voice and exports the track', () => {
    const n = nav({ track: [{ lon: 1, lat: 2, time: 0 }, { lon: 1, lat: 2.001, time: 1000 }] });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    const { rerender } = render(<NavPanel nav={n} />);
    fireEvent.click(screen.getByText('Voice off'));
    expect(n.setVoice).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByText('Track GPX'));
    expect(click).toHaveBeenCalled();
    rerender(<NavPanel nav={{ ...n, voice: true, track: [] }} />);
    fireEvent.click(screen.getByText('Voice on'));
    expect(n.setVoice).toHaveBeenLastCalledWith(false);
    expect(screen.queryByText('Track GPX')).toBeNull();
    click.mockRestore();
  });

  it('names the destination, arrival and re-routing, and has recenter and stop buttons', () => {
    const n = nav({
      follow: false, rerouting: true, motion: { sog: null, cog: null },
      progress: progress({ side: null, next: { kind: 'end', name: '', at: 1, distance: 800 }, upcoming: [{ kind: 'end', name: '', at: 1, distance: 800 }] }),
    });
    const { rerender } = render(<NavPanel nav={n} />);
    expect(screen.getByText('Destination', { exact: false }).textContent).toBe('Destination in 0.8 km');
    expect(screen.getByText('Off the route: re-routing from here…')).toBeTruthy();
    fireEvent.click(screen.getByText('Recenter'));
    expect(n.setFollow).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByLabelText('Stop'));
    expect(n.stop).toHaveBeenCalled();
    rerender(<NavPanel nav={{ ...n, progress: progress({ next: { kind: 'lock', name: '', at: 1, distance: 500 } }) }} />);
    expect(screen.getByText('Lock', { exact: false }).textContent).toBe('Lock in 0.5 km');
    rerender(<NavPanel nav={{ ...n, progress: progress({ arrived: true }) }} />);
    expect(screen.getByText('Arrived')).toBeTruthy();
    rerender(<NavPanel nav={{ ...n, progress: progress({ next: null, upcoming: [] }) }} />);
    expect(screen.queryByText(/ in /)).toBeNull();
  });
});
