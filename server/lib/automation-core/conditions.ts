// apps/openinspection/server/lib/automation-core/conditions.ts
import type { ConditionContext, CoreCondition, Verdict } from './ports';

/**
 * Pure send-time gate evaluation extracted from OI's AutomationConditions mixin.
 * The adapter pre-resolves all DB-derived facts (signed / bookedServiceIds /
 * isStale) into the ConditionContext; this function only decides. Branch order
 * and skip-reason strings are byte-identical to the former mixin body so the
 * characterization snapshot is unchanged.
 */
export function evaluateConditions(ctx: ConditionContext): Verdict {
  // Reminder-staleness gate (adapter computed the predicate).
  if (ctx.triggerKey === 'inspection.reminder' && ctx.isStale) {
    return { ok: false, reason: 'inspection no longer active' };
  }
  if (!ctx.conditionsJson) return { ok: true };

  let cond: CoreCondition;
  try {
    cond = JSON.parse(ctx.conditionsJson) as CoreCondition;
  } catch {
    // Malformed JSON → fail OPEN (treat as no gates) so a corrupt blob doesn't
    // trap the log in 'pending' forever. Notify so the ungated send is observable.
    ctx.onMalformedConditions?.({ ruleId: ctx.ruleId });
    return { ok: true };
  }

  if (cond.requirePaid && !ctx.paid) {
    return { ok: false, reason: 'condition: not paid' };
  }
  if (cond.requireSigned && !ctx.signed) {
    return { ok: false, reason: 'condition: agreement not signed' };
  }
  if (cond.serviceIds && cond.serviceIds.length > 0) {
    const have = new Set(ctx.bookedServiceIds);
    if (!cond.serviceIds.some((id) => have.has(id))) {
      return { ok: false, reason: 'condition: service not matched' };
    }
  }
  return { ok: true };
}
