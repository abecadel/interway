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
    expect((screen.getByText('WSA') as HTMLAnchorElement).href).toBe('https://www.wsa.example/');
    expect((screen.getByText('notices to skippers') as HTMLAnchorElement).href).toBe('https://www.elwis.de/');
    expect(screen.getByText('de.wikipedia.org')).toBeTruthy();
    // the bare sheet: name, status, authority without a link, its odd source as written
    expect(screen.getByText('closed')).toBeTruthy();
    expect(screen.getByText('Nobody').tagName).not.toBe('A');
    expect(screen.getByText('not a url')).toBeTruthy();
    expect(container.querySelectorAll('li')[1].querySelectorAll('dt')).toHaveLength(0);
  });
});
