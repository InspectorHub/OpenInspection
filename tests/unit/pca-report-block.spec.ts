// Regression guard for the whole-branch bug the per-task tests missed: the PCA
// skeleton must render ONLY on commercial reports. buildPcaReportBlock is the
// single gate — residential home inspections (propertyType !== 'commercial')
// get null so getReportData ships no ASTM PCA front matter and PcaSkeleton
// renders nothing.
import { describe, it, expect } from 'vitest';
import { buildPcaReportBlock } from '../../server/lib/pca-report-block';
import { PCA_NARRATIVE_SEED } from '../../server/lib/pca-narrative';

const sections = [
  { id: 'site', title: 'Site', items: [{ severityBucket: 'marginal', resolvedTabs: { defects: [{ included: true, effectiveCategory: 'safety' }] } }] },
];

describe('buildPcaReportBlock — commercial gate', () => {
  it('returns null for a residential report (propertyType single_family)', () => {
    expect(buildPcaReportBlock({ propertyType: 'single_family', sections })).toBeNull();
  });

  it('returns null when propertyType is absent (default home inspection)', () => {
    expect(buildPcaReportBlock({ propertyType: null, sections })).toBeNull();
    expect(buildPcaReportBlock({ sections })).toBeNull();
  });

  it('returns null for any non-commercial value (multi_family)', () => {
    expect(buildPcaReportBlock({ propertyType: 'multi_family', sections })).toBeNull();
  });

  it('assembles the full skeleton block for a commercial report', () => {
    const block = buildPcaReportBlock({ propertyType: 'commercial', pcaNarrative: null, sections });
    expect(block).not.toBeNull();
    expect(block!.sectionRegistry[0].id).toBe('cover');
    expect(block!.narrative.purpose).toBe(PCA_NARRATIVE_SEED.purpose); // seed fallback
    expect(block!.systemsSummary[0]).toMatchObject({ systemId: 'site', worstSeverity: 'marginal', counts: { safety: 1, recommendation: 0, maintenance: 0 } });
    expect(block!.deviations).toEqual([]);
  });

  it('overlays stored narrative + carries stored deviations for a commercial report', () => {
    const block = buildPcaReportBlock({
      propertyType: 'commercial',
      pcaNarrative: { purpose: 'Custom purpose.' },
      deviations: [{ id: 'd1', area: 'Cost threshold', baselineRequirement: '$3k', deviation: 'raised to $5k', reason: 'client' }],
      sections,
    });
    expect(block!.narrative.purpose).toBe('Custom purpose.');
    expect(block!.deviations).toHaveLength(1);
  });
});
