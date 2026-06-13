import { describe, it, expect } from 'vitest';
import { mapRepairItems } from '../../server/lib/report-repair-items';

describe('report repair items mapping', () => {
  it('maps snapshot recommendations to dollar-based repairItems', () => {
    const res = { recommendations: [
      { recommendationId: 'r1', estimateSnapshotMin: 15000, estimateSnapshotMax: 40000, summarySnapshot: 'Replace breaker', contractorTypeSnapshot: 'Licensed Electrician', attachedAt: 1 },
    ] };
    const out = mapRepairItems(res);
    expect(out).toEqual([
      { summary: 'Replace breaker', estimateMin: 150, estimateMax: 400, contractorType: 'Licensed Electrician' },
    ]);
  });

  it('returns undefined when no recommendations', () => {
    expect(mapRepairItems({})).toBeUndefined();
    expect(mapRepairItems({ recommendations: [] })).toBeUndefined();
  });

  it('handles null estimate/contractor', () => {
    const out = mapRepairItems({ recommendations: [{ summarySnapshot: 'x', estimateSnapshotMin: null, estimateSnapshotMax: null, contractorTypeSnapshot: null }] });
    expect(out).toEqual([{ summary: 'x', estimateMin: null, estimateMax: null, contractorType: null }]);
  });

  it('skips recommendations with an empty summary', () => {
    const out = mapRepairItems({ recommendations: [
      { summarySnapshot: '', estimateSnapshotMin: 100, estimateSnapshotMax: 200, contractorTypeSnapshot: null },
    ] });
    expect(out).toBeUndefined();
  });
});
