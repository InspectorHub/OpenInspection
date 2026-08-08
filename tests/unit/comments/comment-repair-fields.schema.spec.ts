import { describe, it, expect } from 'vitest';
import { CommentSchema, UpdateCommentSchema, CommentResponseSchema } from '../../../server/lib/validations/admin.schema';

/**
 * A canned comment carries the SCOPE of a repair and the trade that does it.
 * It carries no price.
 *
 * The API surface is the load-bearing half of that: removing the input from the
 * editor stops a person typing a price, but the schema is what stops a stored
 * integration, an older client build, or a hand-rolled request from writing one
 * anyway. So the assertions below are about what comes OUT of `.parse()` — a
 * Zod object drops unknown keys silently, and "silently" is the whole risk.
 */
describe('comment repair fields schemas', () => {
  it('CommentSchema accepts repair scope and contractor type', () => {
    const parsed = CommentSchema.parse({
      text: 'Replace breaker', severity: 'significant',
      repairSummary: 'Replace the double-tapped breaker',
      recommendedContractorTypeId: 'ct-electrician',
    });
    expect(parsed.repairSummary).toBe('Replace the double-tapped breaker');
    expect(parsed.recommendedContractorTypeId).toBe('ct-electrician');
  });

  it('CommentSchema drops a price a caller tries to attach', () => {
    const parsed = CommentSchema.parse({
      text: 'Replace breaker', severity: 'significant',
      repairSummary: 'Replace the double-tapped breaker',
      estimateMinCents: 15000, estimateMaxCents: 40000,
    }) as Record<string, unknown>;
    expect(Object.keys(parsed)).not.toContain('estimateMinCents');
    expect(Object.keys(parsed)).not.toContain('estimateMaxCents');
    // Positive control: the rest of the payload did survive the parse, so this
    // is "the price was dropped", not "the parse produced nothing".
    expect(parsed.repairSummary).toBe('Replace the double-tapped breaker');
  });

  it('UpdateCommentSchema accepts partial repair fields and no price', () => {
    const parsed = UpdateCommentSchema.parse({ text: 'x', repairSummary: null }) as Record<string, unknown>;
    expect(parsed.repairSummary).toBeNull();
    const withPrice = UpdateCommentSchema.parse({ text: 'x', estimateMaxCents: 40000 }) as Record<string, unknown>;
    expect(Object.keys(withPrice)).not.toContain('estimateMaxCents');
  });

  it('CommentResponseSchema surfaces repair scope and never a price', () => {
    const out = CommentResponseSchema.parse({
      id: '123e4567-e89b-42d3-a456-426614174000', tenantId: '123e4567-e89b-42d3-a456-426614174001',
      text: 'x', category: null, severity: 'significant', section: null, createdAt: new Date().toISOString(),
      repairSummary: 'r', estimateMinCents: 1, estimateMaxCents: 2, recommendedContractorTypeId: 'ct-1',
    }) as Record<string, unknown>;
    expect(out.repairSummary).toBe('r');
    expect(out.recommendedContractorTypeId).toBe('ct-1');
    expect(Object.keys(out)).not.toContain('estimateMinCents');
    expect(Object.keys(out)).not.toContain('estimateMaxCents');
  });
});
