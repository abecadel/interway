import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FishingPanel } from './FishingPanel';

const weather = { current: { time: '2026-06-21T12:00', temperature_2m: 18, wind_speed_10m: 8, wind_direction_10m: 270, wind_gusts_10m: 14, pressure_msl: 1012 },
  hourly: { pressure_msl: [1014.1] } };
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
const now = Date.parse('2026-06-21T12:00:00Z');

describe('FishingPanel', () => {
  it('shows sun, moon and solunar periods, then the weather and sea when asked', async () => {
    const fetchFn = vi.fn(async (url: string) => (url.includes('marine') ? json({ current: { wave_height: 0.4, sea_surface_temperature: 16.6 } }) : json(weather)));
    render(<FishingPanel position={[18.6, 54.4]} label="Gdańsk" onLog={() => {}} now={now} fetchFn={fetchFn} />);
    expect(screen.getByText(/^rises .*, sets /)).toBeTruthy();
    expect(screen.getByText(/% lit; rises/)).toBeTruthy();
    expect(screen.getByText(/major \d{1,2}:\d\d/)).toBeTruthy();
    fireEvent.click(screen.getByText('Weather and sea now'));
    expect(screen.getByText('Getting the weather…')).toBeTruthy();
    expect(await screen.findByText('8 kn from W, gusts 14 kn')).toBeTruthy();
    expect(screen.getByText('1012 hPa, falling 2.1 hPa in 3 h')).toBeTruthy();
    expect(screen.getByText('waves 0.4 m, water 17 °C')).toBeTruthy();
    expect(screen.queryByText('Weather and sea now')).toBeNull();
  });

  it('says when the weather is not available, and leaves out the sea inland', async () => {
    const down = render(<FishingPanel position={[21, 52]} label="x" onLog={() => {}} now={now} fetchFn={async () => json({}, 500)} />);
    fireEvent.click(screen.getByText('Weather and sea now'));
    expect(await screen.findByText('Weather not available (HTTP 500)')).toBeTruthy();
    down.unmount();
    render(<FishingPanel position={[21, 52]} label="x" onLog={() => {}} now={now}
      fetchFn={async (url) => (url.includes('marine') ? json({}, 400) : json({ ...weather, hourly: {} }))} />);
    fireEvent.click(screen.getByText('Weather and sea now'));
    expect(await screen.findByText('1012 hPa')).toBeTruthy();
    expect(screen.queryByText(/waves/)).toBeNull();
  });

  it('logs a catch with the conditions of the moment', async () => {
    const onLog = vi.fn();
    render(<FishingPanel position={[21.6, 53.8]} label="Mikołajki" onLog={onLog} now={now} rules={<p>rules here</p>}
      fetchFn={async (url) => (url.includes('marine') ? json({}) : json(weather))} />);
    expect(screen.getByText('rules here')).toBeTruthy();
    fireEvent.click(screen.getByText('Weather and sea now'));
    await screen.findByText(/kn from W/);
    fireEvent.click(screen.getByText('Log a catch here'));
    fireEvent.change(screen.getByLabelText('Species'), { target: { value: 'Pike' } });
    fireEvent.change(screen.getByLabelText('Length (cm)'), { target: { value: '72' } });
    fireEvent.click(screen.getByLabelText('Released'));
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'reeds' } });
    fireEvent.click(screen.getByText('Save to my catches'));
    expect(onLog).toHaveBeenCalledWith({
      time: '2026-06-21T12:00:00.000Z', position: [21.6, 53.8], place: 'Mikołajki', species: 'Pike', lengthCm: 72, weightKg: undefined,
      released: true, notes: 'reeds', conditions: expect.stringMatching(/^moon .*, wind 8 kn W, 1012 hPa falling 2\.1 hPa in 3 h$/),
    });
    expect(screen.queryByLabelText('Species')).toBeNull();
    // without the weather or notes: the moon only, an unnamed species
    fireEvent.click(screen.getByText('Log a catch here'));
    fireEvent.submit(screen.getByLabelText('Species').closest('form')!);
    expect(onLog).toHaveBeenLastCalledWith(expect.objectContaining({ species: 'unknown', notes: undefined, released: false, lengthCm: undefined }));
  });

  it('the midnight sun, and the default clock', () => {
    const r = render(<FishingPanel position={[18.96, 69.65]} label="Tromsø" onLog={() => {}} now={now} />);
    expect(screen.getByText('rises —, sets —')).toBeTruthy();
    r.unmount();
    render(<FishingPanel position={[18.96, 69.65]} label="Tromsø" onLog={() => {}} />);
    expect(screen.getAllByText(/rises/).length).toBeGreaterThan(0);
  });
});
