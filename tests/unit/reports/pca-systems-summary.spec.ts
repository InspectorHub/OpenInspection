// tests/unit/reports/pca-systems-summary.spec.ts
import { describe, it, expect } from 'vitest';
import { buildSystemsSummary } from '../../../server/lib/pca-systems-summary';

/**
 * IA-32 — the summary reads each item's `severityBucket`, and the report
 * pipeline only ever writes the getRatingBucket domain
 * (`satisfactory | monitor | defect | other`). asSeverity used to accept the
 * OTHER domain (`marginal | significant | minor`), so every real bucket fell
 * through to 'good' and worstSeverity was always 'good' — a system with four
 * safety defects still printed "Good". These fixtures feed the bucket values
 * the pipeline actually produces; the prior fixtures fed severity values it
 * never emits, which is how the correctness bug stayed green.
 */
describe('buildSystemsSummary', () => {
  it('rolls up the worst severity across items using the produced bucket domain', () => {
    const sections = [
      {
        id: 'mep', title: 'Mechanical, Electrical & Plumbing',
        items: [
          { rating: 'd', severityBucket: 'monitor', resolvedTabs: { defects: [
            { included: true, effectiveCategory: 'safety' },
            { included: true, effectiveCategory: 'maintenance' },
            { included: false, effectiveCategory: 'safety' }, // excluded -> not counted
          ] } },
          { rating: 'd', severityBucket: 'defect', resolvedTabs: { defects: [
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
      worstSeverity: 'significant', // defect (→significant) beats monitor (→marginal)
      counts: { safety: 1, recommendation: 1, maintenance: 1 },
    });
  });

  it('maps a single defect item to significant (the core bug: it used to read good)', () => {
    const sections = [{ id: 'roof', title: 'Roof', items: [{ rating: 'd', severityBucket: 'defect' }] }];
    expect(buildSystemsSummary(sections as never)[0].worstSeverity).toBe('significant');
  });

  it('maps monitor to marginal and other to minor', () => {
    const monitor = buildSystemsSummary([{ id: 's', title: 'S', items: [{ severityBucket: 'monitor' }] }] as never);
    expect(monitor[0].worstSeverity).toBe('marginal');
    const other = buildSystemsSummary([{ id: 's', title: 'S', items: [{ severityBucket: 'other' }] }] as never);
    expect(other[0].worstSeverity).toBe('minor');
  });

  it('defaults worstSeverity to good for a system of only satisfactory items', () => {
    const sections = [{ id: 'site', title: 'Site', items: [{ rating: 'g', severityBucket: 'satisfactory' }] }];
    const rows = buildSystemsSummary(sections as never);
    expect(rows[0].worstSeverity).toBe('good');
    expect(rows[0].counts).toEqual({ safety: 0, recommendation: 0, maintenance: 0 });
  });
});
