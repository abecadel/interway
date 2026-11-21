import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CatchList } from './CatchList';

const c = { id: 'a', time: '2026-11-21T10:00:00Z', position: [21.6, 53.8] as [number, number], place: 'Mikołajki', species: 'Pike', lengthCm: 72, weightKg: 3.1, released: true };

describe('CatchList', () => {
  it('lists catches, opens, deletes and exports them', () => {
    const onRemove = vi.fn(), onOpen = vi.fn(), onClose = vi.fn(), download = vi.fn();
    render(<CatchList catches={[c, { ...c, id: 'b', species: 'Perch', lengthCm: undefined, weightKg: undefined, released: false }]} onRemove={onRemove} onOpen={onOpen} onClose={onClose} download={download} />);
    expect(screen.getByText('Pike, 72 cm, 3.1 kg (released)')).toBeTruthy();
    expect(screen.getByText('Perch')).toBeTruthy();
    fireEvent.click(screen.getByText('Pike, 72 cm, 3.1 kg (released)'));
    expect(onOpen).toHaveBeenCalledWith(c);
    fireEvent.click(screen.getByLabelText('Delete Perch'));
    expect(onRemove).toHaveBeenCalledWith('b');
    for (const f of ['CSV', 'GPX', 'GeoJSON']) fireEvent.click(screen.getByText(f));
    expect(download.mock.calls.map((x) => x[2])).toEqual(['interway-catches.csv', 'interway-catches.gpx', 'interway-catches.geojson']);
    fireEvent.click(screen.getByLabelText('Close catches'));
    expect(onClose).toHaveBeenCalled();
  });

  it('explains an empty log', () => {
    render(<CatchList catches={[]} onRemove={() => {}} onOpen={() => {}} onClose={() => {}} download={() => {}} />);
    expect(screen.getByText(/No catches yet/)).toBeTruthy();
  });
});
