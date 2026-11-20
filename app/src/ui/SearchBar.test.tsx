import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { buildLocalIndex } from './localSearch';

vi.mock('./search', () => ({ searchPlaces: vi.fn(async () => []) }));
const { SearchBar } = await import('./SearchBar');

const local = buildLocalIndex([{ type: 'lock', name: 'Schleuse Liepe', lat: 52.85, lon: 13.95 }]);
const saved = [{ label: 'Home marina', position: [1, 2] as [number, number] }];
const recent = [{ label: 'Berlin', position: [13.4, 52.5] as [number, number] }];

describe('SearchBar', () => {
  it('shows saved and recent places while empty, matches while typing, and clears', () => {
    const onSelect = vi.fn();
    const onDirections = vi.fn();
    render(<SearchBar local={local} recent={recent} saved={saved} onSelect={onSelect} onDirections={onDirections} />);
    const input = screen.getByLabelText('Search');
    expect(screen.queryByText('Home marina')).toBeNull();
    fireEvent.focus(input);
    expect(screen.getByText('Home marina')).toBeTruthy();
    expect(screen.getByText('Berlin')).toBeTruthy();
    fireEvent.mouseDown(screen.getByText('Berlin')); // keeps the input focused
    fireEvent.click(screen.getByText('Berlin'));
    expect(onSelect).toHaveBeenLastCalledWith(recent[0]);
    fireEvent.change(input, { target: { value: 'liepe' } });
    fireEvent.click(screen.getByText('Schleuse Liepe · lock'));
    expect(onSelect).toHaveBeenLastCalledWith({ label: 'Schleuse Liepe · lock', position: [13.95, 52.85] });
    fireEvent.change(input, { target: { value: 'xy' } });
    fireEvent.click(screen.getByLabelText('Clear search'));
    expect((input as HTMLInputElement).value).toBe('');
    fireEvent.change(input, { target: { value: 'ab' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect((input as HTMLInputElement).value).toBe('');
    fireEvent.blur(input);
    expect(screen.queryByText('Home marina')).toBeNull();
    fireEvent.click(screen.getByLabelText('Directions'));
    expect(onDirections).toHaveBeenCalled();
  });
});

describe('SearchBar offline', () => {
  it('says when only waterway places are shown, or why nothing is', async () => {
    vi.useFakeTimers();
    const { searchPlaces } = await import('./search');
    vi.mocked(searchPlaces).mockRejectedValue(new Error('Search failed'));
    render(<SearchBar local={local} recent={[]} saved={[]} onSelect={() => {}} onDirections={() => {}} />);
    const input = screen.getByLabelText('Search');
    fireEvent.change(input, { target: { value: 'liepe' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(screen.getByText('Offline: showing waterway places only').className).toContain('info');
    fireEvent.change(input, { target: { value: 'nowhere' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(screen.getByText('Search failed').className).toContain('error');
    vi.useRealTimers();
  });
});
