import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const corridor = vi.hoisted(() => ({
  corridorZoom: vi.fn(() => 14 as number | null),
  corridorUrls: vi.fn(async () => ['a', 'b']),
  saveUrls: vi.fn(async (_u: string[], onProgress: (d: number, t: number) => void) => { onProgress(1, 2); return { saved: 2, failed: 0 }; }),
  clearSaved: vi.fn(async () => true),
}));
vi.mock('../offline/corridor', () => corridor);
const { OfflineMap } = await import('./OfflineMap');

afterEach(() => vi.clearAllMocks());

describe('OfflineMap', () => {
  it('saves the map along the route and clears it', async () => {
    render(<OfflineMap line={[[21, 52], [21.1, 52]]} />);
    await act(async () => fireEvent.click(screen.getByText('Save map for offline')));
    expect(corridor.corridorUrls).toHaveBeenCalledWith([[21, 52], [21.1, 52]], 14);
    expect(screen.getByText('Map saved along the route (zoom 14).', { exact: false })).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByText('Clear saved maps')));
    expect(corridor.clearSaved).toHaveBeenCalled();
    expect(screen.getByText('Save map for offline')).toBeTruthy();
  });

  it('shows progress, failures and errors', async () => {
    let finish!: (r: { saved: number; failed: number }) => void;
    corridor.saveUrls.mockImplementationOnce(async (_u, onProgress) => {
      onProgress(1, 2);
      return new Promise((r) => { finish = r; });
    });
    render(<OfflineMap line={[[21, 52]]} />);
    await act(async () => fireEvent.click(screen.getByText('Save map for offline')));
    expect(screen.getByText('Saving map… 1 / 2')).toBeTruthy();
    await act(async () => finish({ saved: 1, failed: 1 }));
    expect(screen.getByText(/1 tiles failed/)).toBeTruthy();
    corridor.corridorUrls.mockRejectedValueOnce(new Error('offline'));
    await act(async () => fireEvent.click(screen.getByText('Clear saved maps')));
    await act(async () => fireEvent.click(screen.getByText('Save map for offline')));
    expect(screen.getByText(/Could not save the map: offline/)).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByText('Retry')));
    expect(screen.getByText(/Map saved/)).toBeTruthy();
  });

  it('shows that saving starts before the list of tiles is ready', async () => {
    let urls!: (u: string[]) => void;
    corridor.corridorUrls.mockImplementationOnce(() => new Promise((r) => { urls = r; }));
    render(<OfflineMap line={[[21, 52]]} />);
    await act(async () => fireEvent.click(screen.getByText('Save map for offline')));
    expect(screen.getByText('Saving map…')).toBeTruthy();
    await act(async () => urls([]));
  });

  it('says when a route is too long to save', () => {
    corridor.corridorZoom.mockReturnValueOnce(null);
    render(<OfflineMap line={[[21, 52]]} />);
    expect(screen.getByText(/too long to save/)).toBeTruthy();
  });
});
