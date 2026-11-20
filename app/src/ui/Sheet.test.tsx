import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Sheet } from './Sheet';

describe('Sheet', () => {
  it('drags between snaps on phones; a tap toggles peek and half', () => {
    const onSnap = vi.fn();
    const { container, rerender } = render(<Sheet phone snap="half" onSnap={onSnap} title="Route" fab={<button>fab</button>}>body</Sheet>);
    expect(screen.getByText('fab')).toBeTruthy();
    const grip = container.querySelector('.sheet-grip')!;
    const handle = screen.getByLabelText('Route');
    expect(handle.textContent).toBe('');
    fireEvent.pointerMove(grip, { clientY: 300 }); // no press: nothing
    fireEvent.pointerDown(grip, { clientY: 400 });
    fireEvent.pointerMove(grip, { clientY: 396 }); // a few pixels: still a tap
    fireEvent.pointerUp(grip);
    fireEvent.click(handle);
    expect(onSnap).toHaveBeenLastCalledWith('peek');
    // drag up 300 px from half (384 of 768): nearest is full
    fireEvent.pointerDown(grip, { clientY: 400 });
    fireEvent.pointerMove(grip, { clientY: 100 });
    expect((container.querySelector('.sheet') as HTMLElement).style.height).toBe('684px');
    fireEvent.pointerUp(grip);
    fireEvent.click(handle); // the click that ends a drag does not toggle
    expect(onSnap).toHaveBeenLastCalledWith('full');
    expect(onSnap).toHaveBeenCalledTimes(2);
    fireEvent.pointerUp(grip); // a stray release
    rerender(<Sheet phone snap="peek" onSnap={onSnap} title="Route">body</Sheet>);
    expect(handle.textContent).toBe('Route');
    fireEvent.click(handle);
    expect(onSnap).toHaveBeenLastCalledWith('half');
  });

  it('is a side panel with a fold tab on desktop', () => {
    const onSnap = vi.fn();
    const { rerender } = render(<Sheet phone={false} snap="half" onSnap={onSnap} title="x" top={<div>top</div>}>body</Sheet>);
    expect(screen.getByText('top')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Collapse side panel'));
    expect(onSnap).toHaveBeenLastCalledWith('peek');
    rerender(<Sheet phone={false} snap="peek" onSnap={onSnap} title="x">body</Sheet>);
    expect(screen.queryByText('body')).toBeNull();
  });
});
