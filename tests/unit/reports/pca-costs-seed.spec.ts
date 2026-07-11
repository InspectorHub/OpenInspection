import { describe, it, expect } from 'vitest';
import { seedCostFromFinding } from '../../../server/lib/pca-costs';

describe('seedCostFromFinding', () => {
  it('seeds lump sum from the canned-comment estimate midpoint + repairSummary', () => {
    const seed = seedCostFromFinding({}, null, {
      estimateMinCents: 80000, estimateMaxCents: 120000, repairSummary: 'Reseal flashing',
    });
    expect(seed.lumpSumCents).toBe(100000); // midpoint of 80000..120000
    expect(seed.unitCostCents).toBeNull();
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
