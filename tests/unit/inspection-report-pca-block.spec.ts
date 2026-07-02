// tests/unit/inspection-report-pca-block.spec.ts
// Pins the pcaReport assembly contract against the pure inputs getReportData
// passes (registry + narrative resolver + systems-summary aggregation).
import { describe, it, expect } from 'vitest';
import { PCA_SECTION_REGISTRY } from '../../server/lib/pca-section-registry';
import { resolvePcaNarrative, PCA_NARRATIVE_SEED } from '../../server/lib/pca-narrative';
import { buildSystemsSummary } from '../../server/lib/pca-systems-summary';

describe('pcaReport block assembly', () => {
  it('assembles registry + seeded narrative + systems summary from inspection-shaped inputs', () => {
    const sections = [{ id: 'site', title: 'Site', items: [{ severityBucket: 'marginal', resolvedTabs: { defects: [{ included: true, effectiveCategory: 'safety' }] } }] }];
    const pcaReport = {
      sectionRegistry: [...PCA_SECTION_REGISTRY],
      narrative: resolvePcaNarrative(null),
      systemsSummary: buildSystemsSummary(sections as never),
      deviations: ([] as { id: string }[]),
    };
    expect(pcaReport.sectionRegistry[0].id).toBe('cover');
    expect(pcaReport.narrative.purpose).toBe(PCA_NARRATIVE_SEED.purpose);
    expect(pcaReport.systemsSummary[0]).toMatchObject({ systemId: 'site', worstSeverity: 'marginal', counts: { safety: 1, recommendation: 0, maintenance: 0 } });
  });
});
