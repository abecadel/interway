import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CategoryChips, CategoryList } from './CategoryChips';

describe('categories', () => {
  it('toggles a chip', () => {
    const onSelect = vi.fn();
    const { rerender } = render(<CategoryChips active={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Marinas'));
    expect(onSelect).toHaveBeenLastCalledWith('marina');
    rerender(<CategoryChips active="marina" onSelect={onSelect} />);
    expect(screen.getByText('Marinas').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByText('Marinas'));
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it('lists the nearest places of the kind, named or not', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const pois = [{ type: 'fuel' as const, name: '', lat: 52, lon: 20 }, { type: 'fuel' as const, name: 'Orlen', lat: 52.1, lon: 20 }];
    const { rerender } = render(<CategoryList pois={pois} type="fuel" center={[20, 52]} onSelect={onSelect} onClose={onClose} />);
    expect(screen.getByText('Fuel nearby')).toBeTruthy();
    fireEvent.click(screen.getByText('Orlen'));
    expect(onSelect).toHaveBeenLastCalledWith(pois[1]);
    expect(screen.getByText('Fuel')).toBeTruthy(); // the nameless one
    fireEvent.click(screen.getByLabelText('Close list'));
    expect(onClose).toHaveBeenCalled();
    rerender(<CategoryList pois={pois} type="water" center={[20, 52]} onSelect={onSelect} onClose={onClose} />);
    expect(screen.getByText(/^None in the data near here/)).toBeTruthy();
  });
});
