import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlaceCard } from './PlaceCard';

const place = { label: 'Śluza', position: [21, 52] as [number, number], kind: 'Lock', detail: '57 × 9.6 m', at: 12_345, offset: 80 };
const handlers = () => ({ onDirections: vi.fn(), onFrom: vi.fn(), onToggleSave: vi.fn(), onClose: vi.fn() });

describe('PlaceCard', () => {
  afterEach(() => {
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    vi.useRealTimers();
  });

  it('shows the place and its actions', () => {
    const h = handlers();
    const { rerender } = render(<PlaceCard place={place} saved={false} {...h} />);
    expect(screen.getByText('Lock · 57 × 9.6 m')).toBeTruthy();
    expect(screen.getByText('km 12.3 on the route')).toBeTruthy();
    expect(screen.getByText('0.1 km off the route')).toBeTruthy();
    fireEvent.click(screen.getByText('Directions'));
    fireEvent.click(screen.getByText('Start here'));
    fireEvent.click(screen.getByText('Save'));
    fireEvent.click(screen.getByLabelText('Close place'));
    expect([h.onDirections, h.onFrom, h.onToggleSave, h.onClose].every((f) => f.mock.calls.length === 1)).toBe(true);
    rerender(<PlaceCard place={{ label: 'Dropped pin', position: [1, 2], offset: 20 }} saved {...h} />);
    expect(screen.getByText('Saved')).toBeTruthy();
    expect(screen.queryByText(/on the route/)).toBeNull();
    expect(screen.queryByText(/off the route/)).toBeNull();
  });

  it('lists a harbour\'s facts, linking web, phone and e-mail', () => {
    const facts = [{ label: 'VHF', value: 'channel 9' }, { label: 'Phone', value: '+33 1', href: 'tel:+331' },
      { label: 'Website', value: 'port.example', href: 'https://port.example' }];
    render(<PlaceCard place={{ label: 'Port', position: [1, 2], facts }} saved={false} {...handlers()} />);
    expect(screen.getByText('channel 9').tagName).toBe('DD');
    expect((screen.getByText('+33 1') as HTMLAnchorElement).target).toBe('');
    expect((screen.getByText('port.example') as HTMLAnchorElement).target).toBe('_blank');
    expect(screen.getByText(/check with the harbour/)).toBeTruthy();
  });

  it('shares with the system sheet, or copies the link', async () => {
    vi.useFakeTimers();
    const share = vi.fn(async () => {});
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    const { unmount } = render(<PlaceCard place={place} saved={false} {...handlers()} />);
    fireEvent.click(screen.getByText('Share'));
    expect(share).toHaveBeenCalledWith({ title: 'Śluza', url: expect.stringContaining('?to=21.00000,52.00000') });
    unmount();
    Object.defineProperty(navigator, 'share', { value: () => Promise.reject(new Error('cancelled')), configurable: true });
    const r = render(<PlaceCard place={place} saved={false} {...handlers()} />);
    await act(async () => { fireEvent.click(screen.getByText('Share')); });
    r.unmount();
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<PlaceCard place={place} saved={false} {...handlers()} />);
    await act(async () => { fireEvent.click(screen.getByText('Share')); });
    expect(screen.getByText('Link copied')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(2100); });
    expect(screen.getByText('Share')).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByText('Share')); });
    expect(screen.getByText('Share')).toBeTruthy();
  });
});
