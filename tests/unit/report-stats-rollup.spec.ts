import { describe, it, expect } from 'vitest';
import { computeReportStats, type RatingLevel } from '../../server/lib/report-utils';

const levels: RatingLevel[] = [
  { id: 'g',  label: 'Good',          abbreviation: 'G',  color: '#22c55e', severity: 'good',        isDefect: false },
  { id: 'd',  label: 'Deficient',     abbreviation: 'D',  color: '#f43f5e', severity: 'significant', isDefect: true },
  { id: 'ni', label: 'Not Inspected', abbreviation: 'NI', color: '#94a3b8', severity: 'minor',       isDefect: false },
  { id: 'np', label: 'Not Present',   abbreviation: 'NP', color: '#cbd5e1', severity: 'minor',       isDefect: false },
];

describe('computeReportStats roll-ups', () => {
  it('counts included canned + custom defects by category and NI/NP items', () => {
    const sections = [{ id: 's1', title: 'S1', items: [
      { id: 'i1', label: 'A' }, { id: 'i2', label: 'B' }, { id: 'i3', label: 'C' }, { id: 'i4', label: 'D' },
    ] }];
    const results = {
      '_default:s1:i1': {
        rating: 'd',
        tabs: { defects: [
          { cannedId: 'c1', included: true, category: 'safety' },
          { cannedId: 'c2', included: true, category: 'recommendation' },
          { cannedId: 'c3', included: false, category: 'safety' }, // excluded -> not counted
        ] },
      },
      '_default:s1:i2': {
        rating: 'g',
        customComments: { defects: [
          { id: 'x1', title: 't', comment: 'c', included: true, category: 'maintenance' },
          { id: 'x2', title: 't', comment: 'c', included: true }, // no category -> recommendation
        ] },
      },
      '_default:s1:i3': { rating: 'ni' },
      '_default:s1:i4': { rating: 'np' },
    };
    const stats = computeReportStats(sections as never, results as never, levels);
    expect(stats.byCategory).toEqual({ safety: 1, recommendation: 2, maintenance: 1 });
    expect(stats.notInspected).toBe(1);
    expect(stats.notPresent).toBe(1);
  });
});
