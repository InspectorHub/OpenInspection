// Regression guard for the whole-branch bug the per-task tests missed: the PCA
// skeleton must render ONLY on commercial reports. buildPcaReportBlock is the
// single gate — residential home inspections (propertyType !== 'commercial')
// get null so getReportData ships no ASTM PCA front matter and PcaSkeleton
// renders nothing.
import { describe, it, expect } from 'vitest';
import { buildPcaReportBlock } from '../../../server/lib/pca-report-block';
import { PCA_NARRATIVE_SEED } from '../../../server/lib/pca-narrative';

// severityBucket carries the getRatingBucket domain the report pipeline emits
// (`monitor` → marginal severity); the prior 'marginal' here was a value that
// domain never produces (IA-32).
const sections = [
  { id: 'site', title: 'Site', items: [{ severityBucket: 'monitor', resolvedTabs: { defects: [{ included: true, effectiveCategory: 'safety' }] } }] },
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
    expect(block!.narrative.purpose).toBe(PCA_NARRATIVE_SEED.purpose); // seed fallback
    expect(block!.systemsSummary[0]).toMatchObject({ systemId: 'site', worstSeverity: 'marginal', counts: { safety: 1, recommendation: 0, maintenance: 0 } });
    expect(block!.deviations).toEqual([]);
  });

  /**
   * ONE PROJECTION OF THE SECTION LIST, AND IT IS TIER-GATED.
   *
   * This block used to ship `sectionRegistry: [...PCA_SECTION_REGISTRY]` — the
   * WHOLE registry, ungated — beside the narrative. Nothing read it: the table
   * of contents is `outline`, built server-side by
   * `buildReportOutline(gatedSectionRegistry(tier))`, and the skeleton's own
   * headings come from the paraglide message keys. The only thing keeping the
   * field alive was an assertion in this file that it existed.
   *
   * A second copy of the section list is not merely redundant, it is wrong for
   * `light_commercial`: `gatedSectionRegistry` drops the Transmittal Letter and
   * the Systems Summary for that tier, and the ungated copy lists them anyway.
   * A reader who ever trusted it would have been told the report contains
   * sections it does not render.
   */
  it('ships no second, ungated copy of the section registry', () => {
    const block = buildPcaReportBlock({ propertyType: 'commercial', pcaNarrative: null, sections });
    expect(block).not.toBeNull();
    expect('sectionRegistry' in (block as object)).toBe(false);
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
