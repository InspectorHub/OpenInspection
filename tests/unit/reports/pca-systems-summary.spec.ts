// tests/unit/pca-systems-summary.spec.ts
import { describe, it, expect } from 'vitest';
import { buildSystemsSummary } from '../../../server/lib/pca-systems-summary';

describe('buildSystemsSummary', () => {
  it('returns one row per system with worst severity + included-defect category counts', () => {
    const sections = [
      {
        id: 'mep', title: 'Mechanical, Electrical & Plumbing',
        items: [
          { rating: 'd', severityBucket: 'marginal', resolvedTabs: { defects: [
            { included: true, effectiveCategory: 'safety' },
            { included: true, effectiveCategory: 'maintenance' },
            { included: false, effectiveCategory: 'safety' }, // excluded -> not counted
          ] } },
          { rating: 'd', severityBucket: 'significant', resolvedTabs: { defects: [
            { included: true }, // no category -> recommendation default
          ] } },
        ],
      },
    ];
    const rows = buildSystemsSummary(sections as never);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      systemId: 'mep',
      systemTitle: 'Mechanical, Electrical & Plumbing',
      worstSeverity: 'significant', // significant beats marginal
      counts: { safety: 1, recommendation: 1, maintenance: 1 },
    });
  });

  it('defaults worstSeverity to good for a system with no rated defects', () => {
    const sections = [{ id: 'site', title: 'Site', items: [{ rating: 'g', severityBucket: 'good' }] }];
    const rows = buildSystemsSummary(sections as never);
    expect(rows[0].worstSeverity).toBe('good');
    expect(rows[0].counts).toEqual({ safety: 0, recommendation: 0, maintenance: 0 });
  });
});
