import { describe, it, expect } from 'vitest';
import { CommentSchema, UpdateCommentSchema, CommentResponseSchema } from '../../../server/lib/validations/admin.schema';

describe('comment repair fields schemas', () => {
  it('CommentSchema accepts the 4 repair fields', () => {
    const parsed = CommentSchema.parse({
      text: 'Replace breaker', severity: 'significant',
      repairSummary: 'Replace the double-tapped breaker', estimateMinCents: 15000, estimateMaxCents: 40000,
      recommendedContractorTypeId: 'ct-electrician',
    });
    expect(parsed.repairSummary).toBe('Replace the double-tapped breaker');
    expect(parsed.estimateMinCents).toBe(15000);
    expect(parsed.estimateMaxCents).toBe(40000);
    expect(parsed.recommendedContractorTypeId).toBe('ct-electrician');
  });

  it('UpdateCommentSchema accepts partial repair fields', () => {
    const parsed = UpdateCommentSchema.parse({ text: 'x', estimateMaxCents: null });
    expect(parsed.estimateMaxCents).toBeNull();
  });

  it('CommentResponseSchema surfaces repair fields (not stripped)', () => {
    const out = CommentResponseSchema.parse({
      id: '123e4567-e89b-42d3-a456-426614174000', tenantId: '123e4567-e89b-42d3-a456-426614174001',
      text: 'x', category: null, severity: 'significant', section: null, createdAt: new Date().toISOString(),
      repairSummary: 'r', estimateMinCents: 1, estimateMaxCents: 2, recommendedContractorTypeId: 'ct-1',
    });
    expect(out.repairSummary).toBe('r');
    expect(out.recommendedContractorTypeId).toBe('ct-1');
  });
});
