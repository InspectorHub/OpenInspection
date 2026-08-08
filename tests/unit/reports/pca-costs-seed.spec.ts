import { describe, it, expect } from 'vitest';
import { seedCostFromFinding } from '../../../server/lib/pca-costs';

describe('seedCostFromFinding', () => {
  it('takes the remedy text from the canned comment and no money with it', () => {
    // The canned-comment library holds repair SCOPE, not a price — the
    // estimate columns it used to carry are gone. The remedy text still seeds;
    // the cost stays empty for the assessor to enter.
    const seed = seedCostFromFinding({}, null, { repairSummary: 'Reseal flashing' });
    expect(seed.suggestedRemedy).toBe('Reseal flashing');
    expect(seed.lumpSumCents).toBeNull();
    expect(seed.unitCostCents).toBeNull();
  });

  it('a canned comment cannot smuggle a price back in through an extra key', () => {
    const seed = seedCostFromFinding({}, null, {
      repairSummary: 'Reseal flashing',
      // Not part of CannedCommentSeed any more; a stale caller may still send it.
      ...({ estimateMinCents: 80000, estimateMaxCents: 120000 } as object),
    });
    expect(seed.lumpSumCents).toBeNull();
    expect(seed.suggestedRemedy).toBe('Reseal flashing');
  });

  it('falls back to the finding recommendation snapshot when no canned comment', () => {
    const seed = seedCostFromFinding(
      { recommendations: [{ estimateSnapshotMin: 50000, estimateSnapshotMax: 50000, summarySnapshot: 'Repair by roofer' }] },
      { defaultEstimateMin: 999, defaultEstimateMax: 999, defaultRecommendation: 'template default' },
    );
    expect(seed.lumpSumCents).toBe(50000);
    expect(seed.suggestedRemedy).toBe('Repair by roofer');
  });

  it('falls back to template defaults when nothing else has data', () => {
    const seed = seedCostFromFinding({}, {
      defaultEstimateMin: 20000, defaultEstimateMax: 60000, defaultRecommendation: 'Monitor',
    });
    expect(seed.lumpSumCents).toBe(40000);
    expect(seed.suggestedRemedy).toBe('Monitor');
  });

  it('returns null cost + empty remedy when no source has data', () => {
    const seed = seedCostFromFinding({}, null);
    expect(seed.lumpSumCents).toBeNull();
    expect(seed.suggestedRemedy).toBe('');
  });
});
