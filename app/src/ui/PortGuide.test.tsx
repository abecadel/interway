import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SAMPLE } from '../routing/ports.fixture';
import { PortGuide } from './PortGuide';

describe('PortGuide', () => {
  it('shows the facts with links', () => {
    render(<PortGuide port={SAMPLE} />);
    expect(screen.getByText('355, 50 for visitors')).toBeTruthy();
    expect(screen.getByText('channel 17')).toBeTruthy();
    expect(screen.getByText('40 m')).toBeTruthy();
    expect(screen.getByText('water, showers')).toBeTruthy();
    expect(screen.getByRole('link', { name: '+385 21 398 599' }).getAttribute('href')).toBe('tel:+38521398599');
    expect(screen.getByRole('link', { name: 'm.split@aci-club.hr' }).getAttribute('href')).toBe('mailto:m.split@aci-club.hr');
    expect(screen.getAllByRole('link', { name: 'aci-marinas.com' })[0].getAttribute('href')).toBe('https://aci-marinas.com');
    expect(screen.getByRole('link', { name: 'booking.example' }).getAttribute('target')).toBe('_blank');
  });
  it('leaves out what is unknown', () => {
    const bare = { ...SAMPLE, berths: null, visitorBerths: null, maxLengthM: null, depthM: null, vhf: '16, 68', phone: null, email: null,
      website: null, booking: null, fuel: null, facilities: [], fees: null, season: null, approach: null, notes: null };
    render(<PortGuide port={bare} />);
    expect(screen.queryByText('Berths')).toBeNull();
    expect(screen.queryByText('Facilities')).toBeNull();
    expect(screen.getByText('16, 68')).toBeTruthy();
  });
  it('shows a visitor count alone', () => {
    render(<PortGuide port={{ ...SAMPLE, berths: null }} />);
    expect(screen.getByText('50 for visitors')).toBeTruthy();
  });
});
