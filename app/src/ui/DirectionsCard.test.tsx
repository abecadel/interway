import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { defaultProfile } from '../routing/router';
import { DirectionsCard } from './DirectionsCard';

const p = (label: string) => ({ label, position: [1, 2] as [number, number] });
const props = {
  start: p('Berlin'), end: p('Hamburg'), via: [], picking: null, profile: defaultProfile, customOpen: false,
  setStart: vi.fn(), setEnd: vi.fn(), setVia: vi.fn(), setPicking: vi.fn(), myPosition: vi.fn(), setProfile: vi.fn(),
  onCustom: vi.fn(), onClose: vi.fn(),
};

describe('DirectionsCard folded to one line', () => {
  it('names the ends, the waypoints and the boat', () => {
    const onEdit = vi.fn();
    const { rerender } = render(<DirectionsCard {...props} compact onEdit={onEdit} />);
    expect(screen.getByLabelText('Edit route').textContent).toBe('Berlin → Hamburg · Small boat');
    fireEvent.click(screen.getByLabelText('Edit route'));
    expect(onEdit).toHaveBeenCalled();
    rerender(<DirectionsCard {...props} via={[p('a')]} profile={{ ...defaultProfile, draft: 3 }} compact />);
    expect(screen.getByLabelText('Edit route').textContent).toBe('Berlin → Hamburg · 1 waypoint · Custom boat');
    rerender(<DirectionsCard {...props} via={[p('a'), p('b')]} compact />);
    expect(screen.getByLabelText('Edit route').textContent).toContain('2 waypoints');
  });
});
