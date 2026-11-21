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
    // past the top it gives only a little
    expect(parseFloat((container.querySelector('.sheet') as HTMLElement).style.height)).toBeCloseTo(678.5, 0);
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

  it('flings on to the next snap, and lets go when the pointer is cancelled', () => {
    const onSnap = vi.fn();
    let now = 0;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { container } = render(<Sheet phone snap="peek" onSnap={onSnap} title="Route">body</Sheet>);
    const grip = container.querySelector('.sheet-grip')!;
    fireEvent.pointerDown(grip, { clientY: 700 });
    now = 10;
    fireEvent.pointerMove(grip, { clientY: 690 });
    now = 20;
    fireEvent.pointerMove(grip, { clientY: 670 }); // 2000 px/s upwards, only 30 px moved
    fireEvent.pointerUp(grip);
    expect(onSnap).toHaveBeenLastCalledWith('half');
    // two samples at the same moment: no speed, the nearest snap
    fireEvent.pointerDown(grip, { clientY: 700 });
    fireEvent.pointerMove(grip, { clientY: 670 });
    fireEvent.pointerUp(grip);
    expect(onSnap).toHaveBeenLastCalledWith('peek');
    fireEvent.pointerDown(grip, { clientY: 700 });
    fireEvent.pointerMove(grip, { clientY: 600 });
    expect((container.querySelector('.sheet') as HTMLElement).style.height).not.toBe('');
    fireEvent.pointerCancel(grip);
    expect((container.querySelector('.sheet') as HTMLElement).style.height).toBe('');
    fireEvent.pointerUp(grip);
    expect(onSnap).toHaveBeenCalledTimes(2);
    clock.mockRestore();
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
