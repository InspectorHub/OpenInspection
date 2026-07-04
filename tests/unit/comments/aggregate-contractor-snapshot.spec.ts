import { describe, it, expect } from 'vitest';
import { AttachedRecommendationItemSchema } from '../../../server/lib/validations/recommendation.schema';

describe('AttachedRecommendationItemSchema', () => {
  it('carries contractorTypeSnapshot', () => {
    const v = AttachedRecommendationItemSchema.parse({
      recommendationId: 'r1', estimateSnapshotMin: 100, estimateSnapshotMax: 200,
      summarySnapshot: 'fix', contractorTypeSnapshot: 'Licensed Electrician', attachedAt: 1, itemId: 'i1',
    });
    expect(v.contractorTypeSnapshot).toBe('Licensed Electrician');
  });

  it('accepts null contractorTypeSnapshot', () => {
    const v = AttachedRecommendationItemSchema.parse({
      recommendationId: 'r1', estimateSnapshotMin: null, estimateSnapshotMax: null,
      summarySnapshot: '', contractorTypeSnapshot: null, attachedAt: 0, itemId: 'i1',
    });
    expect(v.contractorTypeSnapshot).toBeNull();
  });
});
