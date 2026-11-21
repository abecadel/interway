import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { island, land } from '../test/rulesFixture';
import { RulesView } from './RulesView';

describe('RulesView', () => {
  it('shows each country with its rules, authority and sources', () => {
    render(<RulesView rules={[land, island]} inland sea={false} />);
    expect(screen.getByText('Landland')).toBeTruthy();
    expect(screen.getByText('licence over 10 kW')).toBeTruthy();
    expect(screen.getByText('Waterways Authority').getAttribute('href')).toBe('https://example.org');
    expect(screen.getByText('Coastguard').tagName).not.toBe('A');
    expect(screen.getAllByText('example.org')).toHaveLength(3);
  });
});
