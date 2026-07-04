import { describe, it, expect } from 'vitest';
import { aggregateAttachedRecommendations } from '../../../server/lib/aggregate-recommendations';

const rec = (id: string) => ({
  recommendationId: id, estimateSnapshotMin: 50000, estimateSnapshotMax: 150000,
  summarySnapshot: 'Fix ' + id, contractorTypeSnapshot: 'Licensed Electrician', attachedAt: 1,
});

describe('aggregateAttachedRecommendations', () => {
  it('dedupes the dual-key write (composite + bare) — counts each attachment once', () => {
    const data = {
      '_default:sec1:item1': { recommendations: [rec('r1')] },
      'item1':              { recommendations: [rec('r1')] }, // same logical item, second key
    };
    const out = aggregateAttachedRecommendations(data);
    expect(out.totals.count).toBe(1);
    expect(out.totals.estimateMinSum).toBe(50000);
    expect(out.totals.estimateMaxSum).toBe(150000);
    expect(out.items[0].contractorTypeSnapshot).toBe('Licensed Electrician');
    expect(out.items[0].itemId).toBe('item1'); // normalized to bare id
  });

  it('keeps the same recommendation attached to two DIFFERENT items as two entries', () => {
    const data = {
      'item1': { recommendations: [rec('r1')] },
      'item2': { recommendations: [rec('r1')] },
    };
    const out = aggregateAttachedRecommendations(data);
    expect(out.totals.count).toBe(2);
    expect(out.totals.estimateMinSum).toBe(100000);
  });

  it('handles empty / missing recommendations', () => {
    expect(aggregateAttachedRecommendations({}).totals.count).toBe(0);
    expect(aggregateAttachedRecommendations(null).totals.count).toBe(0);
    expect(aggregateAttachedRecommendations({ item1: {} }).totals.count).toBe(0);
  });
});
