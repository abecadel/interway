import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const searchPlaces = vi.hoisted(() => vi.fn());
vi.mock('./search', () => ({ searchPlaces }));
const { PointInput } = await import('./PointInput');

const props = (over = {}) => ({
  label: 'A', value: null, picking: false, onPick: vi.fn(), onMyPosition: vi.fn(), onSelect: vi.fn(), ...over,
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  searchPlaces.mockReset();
});

const type = async (text: string) => {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: text } });
  await act(async () => { await vi.advanceTimersByTimeAsync(350); });
};

describe('PointInput', () => {
  it('searches after a pause and selects a result', async () => {
    searchPlaces.mockResolvedValue([{ label: 'Giżycko, Polska', position: [21.76, 54.03] }]);
    const p = props({ near: [21, 52] });
    render(<PointInput {...p} />);
    await type('gi'); // too short: no search
    expect(searchPlaces).not.toHaveBeenCalled();
    await type('Giży');
    expect(searchPlaces).toHaveBeenCalledWith('Giży', [21, 52], expect.any(AbortSignal));
    fireEvent.click(screen.getByText('Giżycko, Polska'));
    expect(p.onSelect).toHaveBeenCalledWith({ position: [21.76, 54.03], label: 'Giżycko, Polska' });
    expect(screen.getByRole('textbox')).toHaveProperty('value', '');
    expect(screen.queryByText('Giżycko, Polska')).toBeNull();
  });

  it('shows search errors but ignores aborted ones', async () => {
    searchPlaces.mockResolvedValue([]);
    searchPlaces.mockRejectedValueOnce(new Error('Search failed: HTTP 503'));
    render(<PointInput {...props()} />);
    await type('Wrocław');
    expect(screen.getByText('Search failed: HTTP 503')).toBeTruthy();

    let reject!: (e: Error) => void;
    searchPlaces.mockReturnValueOnce(new Promise((_, r) => { reject = r; }));
    await type('Wrocław 2');
    await type('Wrocław 3'); // aborts the previous request
    await act(async () => reject(new Error('aborted')));
    expect(screen.queryByText('aborted')).toBeNull();
  });

  it('shows waterway places from the data at once and adds online results', async () => {
    const { buildLocalIndex } = await import('./localSearch');
    const local = buildLocalIndex([{ type: 'lock', name: 'Schleuse Liepe', lon: 13.95, lat: 52.85 }]);
    let resolve!: (r: unknown) => void;
    searchPlaces.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    const p = props({ local });
    render(<PointInput {...p} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'liepe' } });
    expect(screen.getByText('Schleuse Liepe · lock')).toBeTruthy(); // before any network
    await act(async () => { await vi.advanceTimersByTimeAsync(350); });
    await act(async () => resolve([{ label: 'Liepe, Deutschland', position: [14, 54] }]));
    expect(screen.getByText('Liepe, Deutschland')).toBeTruthy();
    fireEvent.click(screen.getByText('Schleuse Liepe · lock'));
    expect(p.onSelect).toHaveBeenCalledWith({ position: [13.95, 52.85], label: 'Schleuse Liepe · lock' });
  });

  it('says it is offline when only the data can answer', async () => {
    const { buildLocalIndex } = await import('./localSearch');
    const local = buildLocalIndex([{ type: 'lock', name: 'Schleuse Liepe', lon: 13.95, lat: 52.85 }]);
    searchPlaces.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<PointInput {...props({ local })} />);
    await type('liepe');
    expect(screen.getByText('Offline: showing waterway places only')).toBeTruthy();
    expect(screen.getByText('Schleuse Liepe · lock')).toBeTruthy();
    await type('xyzzy');
    expect(screen.getByText('Failed to fetch')).toBeTruthy();
  });

  it('wires the buttons and shows the selected value', () => {
    const p = props({ value: { label: 'My position', position: [1, 2] }, picking: true });
    render(<PointInput {...p} />);
    expect(screen.getByRole('textbox').getAttribute('placeholder')).toBe('My position');
    fireEvent.click(screen.getByText('Click on the map…'));
    fireEvent.click(screen.getByText('My position'));
    fireEvent.click(screen.getByTitle('Clear'));
    expect(p.onPick).toHaveBeenCalled();
    expect(p.onMyPosition).toHaveBeenCalled();
    expect(p.onSelect).toHaveBeenCalledWith(null);
  });

  it('has a hint when empty', () => {
    render(<PointInput {...props()} />);
    expect(screen.getByRole('textbox').getAttribute('placeholder')).toMatch(/click the map/);
    expect(screen.getByText('Pick on map')).toBeTruthy();
    expect(screen.queryByTitle('Clear')).toBeNull();
  });
});
