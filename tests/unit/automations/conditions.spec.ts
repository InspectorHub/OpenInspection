// apps/openinspection/tests/unit/automation-core/conditions.spec.ts
import { describe, it, expect, vi } from 'vitest';
import { evaluateConditions } from '../../../server/lib/automation-core/conditions';
import type { ConditionContext } from '../../../server/lib/automation-core/ports';

function ctx(over: Partial<ConditionContext> = {}): ConditionContext {
  return {
    triggerKey: 'report.published', isStale: false, conditionsJson: null,
    paid: false, signed: false, bookedServiceIds: [], ruleId: 'r1', ...over,
  };
}

describe('evaluateConditions (core)', () => {
  it('stale reminder → "inspection no longer active"', () => {
    expect(evaluateConditions(ctx({ triggerKey: 'inspection.reminder', isStale: true })))
      .toEqual({ ok: false, reason: 'inspection no longer active' });
  });
  it('no conditions json → ok', () => {
    expect(evaluateConditions(ctx())).toEqual({ ok: true });
  });
  it('malformed json → fail OPEN + calls onMalformedConditions', () => {
    const warn = vi.fn();
    expect(evaluateConditions(ctx({ conditionsJson: '{bad', onMalformedConditions: warn })))
      .toEqual({ ok: true });
    expect(warn).toHaveBeenCalledWith({ ruleId: 'r1' });
  });
  it('requirePaid + unpaid → "condition: not paid"', () => {
    expect(evaluateConditions(ctx({ conditionsJson: JSON.stringify({ requirePaid: true }), paid: false })))
      .toEqual({ ok: false, reason: 'condition: not paid' });
  });
  it('requirePaid + paid → ok', () => {
    expect(evaluateConditions(ctx({ conditionsJson: JSON.stringify({ requirePaid: true }), paid: true })))
      .toEqual({ ok: true });
  });
  it('requireSigned + not signed → "condition: agreement not signed"', () => {
    expect(evaluateConditions(ctx({ conditionsJson: JSON.stringify({ requireSigned: true }), signed: false })))
      .toEqual({ ok: false, reason: 'condition: agreement not signed' });
  });
  it('serviceIds + no overlap → "condition: service not matched"', () => {
    expect(evaluateConditions(ctx({
      conditionsJson: JSON.stringify({ serviceIds: ['a'] }), bookedServiceIds: ['b'],
    }))).toEqual({ ok: false, reason: 'condition: service not matched' });
  });
  it('serviceIds + overlap → ok', () => {
    expect(evaluateConditions(ctx({
      conditionsJson: JSON.stringify({ serviceIds: ['a', 'c'] }), bookedServiceIds: ['c'],
    }))).toEqual({ ok: true });
  });
});
