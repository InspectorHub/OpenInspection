import { describe, it, expect } from 'vitest';
import { getNaKind, type RatingLevel } from '../../server/lib/report-utils';

const levels: RatingLevel[] = [
  { id: 'ni', label: 'Not Inspected', abbreviation: 'NI', color: '#94a3b8', severity: 'minor', isDefect: false },
  { id: 'np', label: 'Not Present',   abbreviation: 'NP', color: '#cbd5e1', severity: 'minor', isDefect: false },
  { id: 'g',  label: 'Good',          abbreviation: 'G',  color: '#22c55e', severity: 'good',  isDefect: false },
  { id: 'd',  label: 'Deficient',     abbreviation: 'D',  color: '#f43f5e', severity: 'significant', isDefect: true },
];

describe('getNaKind', () => {
  it('classifies NI as not_inspected and NP as not_present', () => {
    expect(getNaKind('ni', levels)).toBe('not_inspected');
    expect(getNaKind('np', levels)).toBe('not_present');
  });
  it('returns null for non-na levels (good / defect)', () => {
    expect(getNaKind('g', levels)).toBeNull();
    expect(getNaKind('d', levels)).toBeNull();
  });
  it('returns null for a missing rating or empty level set', () => {
    expect(getNaKind(null, levels)).toBeNull();
    expect(getNaKind('ni', [])).toBeNull();
    expect(getNaKind('unknown-id', levels)).toBeNull();
  });
  it('falls back to the label when the abbreviation is nonstandard', () => {
    const custom: RatingLevel[] = [
      { id: 'x', label: 'Not present on site', abbreviation: 'NPS', color: '#ccc', severity: 'minor', isDefect: false },
    ];
    expect(getNaKind('x', custom)).toBe('not_present');
  });
});
