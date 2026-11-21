import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fishingPL } from '../test/fishingFixture';
import { FishingRulesView } from './FishingRulesView';

describe('FishingRulesView', () => {
  it('shows what is closed on the day, licences and bans, the seasons and the sources', () => {
    render(<FishingRulesView rules={fishingPL} country="Poland" day="2027-03-10" />);
    expect(screen.getByText('Fishing rules: Poland')).toBeTruthy();
    expect(screen.getByText('Closed on 2027-03-10: Pike (inland), Cod (sea).')).toBeTruthy();
    expect(screen.getByText('Wody Polskie permit (WIR app)')).toBeTruthy();
    expect(screen.getByText('RecFishing app')).toBeTruthy();
    expect(screen.getByText('Closed seasons, sizes and limits (4)')).toBeTruthy();
    expect(screen.getByText('Zander: closed 1 Nov–28 Feb; at least 45 cm (all waters)')).toBeTruthy();
    expect(screen.getByText('Buy a licence online').getAttribute('href')).toBe('https://wir.example');
    expect(screen.getByText('Wody Polskie').getAttribute('href')).toBe('https://wody.example');
  });

  it('says when a closure covers all waters', () => {
    render(<FishingRulesView rules={fishingPL} country="Poland" day="2026-12-01" />);
    expect(screen.getByText('Closed on 2026-12-01: Cod (sea), Zander (all waters).')).toBeTruthy();
  });

  it('a country without sea rules, purchase link, authority page or seasons', () => {
    render(<FishingRulesView rules={{ ...fishingPL, sea: null, buy: null, seasons: [], authority: { name: 'Ministry', url: null } }} country="X" day="2027-06-10" />);
    expect(screen.queryByText(/Closed on/)).toBeNull();
    expect(screen.queryByText('At sea')).toBeNull();
    expect(screen.queryByText('Buy a licence online')).toBeNull();
    expect(screen.getByText('Ministry').tagName).toBe('SPAN');
    expect(screen.queryByText(/Closed seasons, sizes/)).toBeNull();
  });
});
