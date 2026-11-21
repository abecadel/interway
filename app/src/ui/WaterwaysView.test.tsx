import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { empty, kanal } from '../test/waterwayFixture';
import { WaterwaysView } from './WaterwaysView';

describe('WaterwaysView', () => {
  it('shows the facts, links and sources of each waterway, leaving out what is unknown', () => {
    const { container } = render(<WaterwaysView waterways={[kanal, empty]} />);
    expect(screen.getByText('Kanal (A – B)')).toBeTruthy();
    expect(screen.getByText('seasonal')).toBeTruthy();
    expect(screen.getByText('usually 2.5 m; draft up to 1.5 m; less in summer')).toBeTruthy();
    expect(screen.getByText('about 1.2 m/s; faster in spring')).toBeTruthy();
    expect(screen.getByText('3; 190 × 12 m; 6–22')).toBeTruthy();
    expect(screen.getByText('4 m')).toBeTruthy();
    expect(screen.getByText('tidal, spring range about 0.3 m: to the first lock')).toBeTruthy();
    expect(screen.getByText('A to B · checked 2026-11-21')).toBeTruthy();
    expect((screen.getByText('WSA') as HTMLAnchorElement).href).toBe('https://www.wsa.example/');
    expect((screen.getByText('notices to skippers') as HTMLAnchorElement).href).toBe('https://www.elwis.de/');
    expect(screen.getByText('de.wikipedia.org')).toBeTruthy();
    // the bare sheet: name, status, authority without a link, its odd source as written
    expect(screen.getByText('closed')).toBeTruthy();
    expect(screen.getByText('Nobody').tagName).not.toBe('A');
    expect(screen.getByText('not a url')).toBeTruthy();
    expect(container.querySelectorAll('li')[1].querySelectorAll('dt')).toHaveLength(0);
    // a card each: the key facts in one line, details folded when there are several, sources folded
    expect(screen.getByText('class Vb · draft ≤ 1.5 m · bridges ≥ 4 m · 3 locks')).toBeTruthy();
    expect(container.querySelector('details.waterway-more')!.hasAttribute('open')).toBe(false);
    expect(screen.getAllByText('Sources (2)')).toHaveLength(1);
  });

  it('opens the details of a single waterway, and counts one lock', () => {
    const { container } = render(<WaterwaysView waterways={[{ ...kanal, class: null, locks: { ...kanal.locks, count: 1 } }]} />);
    expect(screen.getByText('draft ≤ 1.5 m · bridges ≥ 4 m · 1 lock')).toBeTruthy();
    expect(container.querySelector('details.waterway-more')!.hasAttribute('open')).toBe(true);
  });
});
