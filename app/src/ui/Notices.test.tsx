import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Notices } from './Notices';

describe('Notices', () => {
  it('shows nothing without notices', () => {
    const { container } = render(<Notices notices={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('shows the first as a card and folds the rest and its lines under it', () => {
    const { container } = render(<Notices notices={[
      { level: 'error', title: '2 waterways closed', items: ['A closed', 'B closed'] },
      { level: 'info', title: 'Open sea', detail: 'Check the weather.' },
    ]} />);
    expect(container.querySelector('.notices.error')).toBeTruthy();
    expect(screen.queryByText('A closed')).toBeNull();
    expect(screen.queryByText('Open sea')).toBeNull();
    fireEvent.click(screen.getByText('+ 3 more notes'));
    expect(screen.getByText('A closed')).toBeTruthy();
    expect(screen.getByText('Check the weather.')).toBeTruthy();
    fireEvent.click(screen.getByText('Show less'));
    expect(screen.queryByText('Open sea')).toBeNull();
  });

  it('says one more note, or none', () => {
    const { rerender } = render(<Notices notices={[{ level: 'warn', title: 'a' }, { level: 'info', title: 'b' }]} />);
    expect(screen.getByText('+ 1 more note')).toBeTruthy();
    rerender(<Notices notices={[{ level: 'info', title: 'only' }]} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
