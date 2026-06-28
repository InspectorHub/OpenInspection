import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import { automations, inspections, agreementRequests, inspectionServices } from '../../lib/db/schema';
import { logger } from '../../lib/logger';
import { isReportPublished } from '../../lib/status/report-status';
import { evaluateConditions as coreEvaluate } from '../../lib/automation-core';
import type { CoreCondition } from '../../lib/automation-core';
import { type Constructor } from './shared';
import type { AutomationBase } from './shared';

/**
 * Conditions mixin: OI adapter over the core condition evaluator. Pre-resolves
 * the DB-derived facts (agreement-signed, booked service ids, reminder
 * staleness) into a ConditionContext, then delegates the decision to
 * automation-core. The DB reads stay LAZY (a read runs only when its gate is
 * actually requested), so the verdict and skip-reason are byte-identical to the
 * former monolith. One subtlety vs the old sequential body: facts are resolved
 * BEFORE the core decides, so a rule that sets multiple gates and skips on an
 * earlier one (e.g. requirePaid) may run a later gate's read-only scoped SELECT
 * that the old short-circuit would have skipped — a query-count delta on the
 * cron path only, never an outcome change.
 */
export function AutomationConditions<TBase extends Constructor<AutomationBase>>(Base: TBase) {
    return class extends Base {
        async evaluateConditions(
            db: DrizzleD1Database,
            automation: typeof automations.$inferSelect,
            inspection: typeof inspections.$inferSelect,
        ): Promise<{ ok: true } | { ok: false; reason: string }> {
            // Reminder-staleness predicate (computed here; same condition as before).
            const isStale = inspection.status === 'cancelled' || inspection.status === 'completed' ||
                            isReportPublished(inspection.reportStatus);

            // Parse the requested gates to decide which lazy DB reads to run. We
            // never query for a gate that isn't asked for (preserves the old laziness).
            let cond: CoreCondition | null = null;
            if (automation.conditions) {
                try { cond = JSON.parse(automation.conditions) as CoreCondition; } catch { cond = null; }
            }

            let signed = false;
            if (cond?.requireSigned) {
                const rows = await db.select({ id: agreementRequests.id }).from(agreementRequests)
                    .where(and(
                        eq(agreementRequests.tenantId, inspection.tenantId),
                        eq(agreementRequests.inspectionId, inspection.id),
                        eq(agreementRequests.status, 'signed'),
                    )).limit(1);
                signed = rows.length > 0;
            }

            let bookedServiceIds: string[] = [];
            if (cond?.serviceIds && cond.serviceIds.length > 0) {
                const rows = await db.select({ serviceId: inspectionServices.serviceId }).from(inspectionServices)
                    .where(eq(inspectionServices.inspectionId, inspection.id));
                bookedServiceIds = rows.map((r) => r.serviceId);
            }

            return coreEvaluate({
                triggerKey: automation.trigger,
                isStale,
                conditionsJson: automation.conditions,
                paid: inspection.paymentStatus === 'paid',
                signed,
                bookedServiceIds,
                ruleId: automation.id,
                onMalformedConditions: ({ ruleId }) =>
                    logger.warn('AutomationService.evaluateConditions: malformed conditions JSON, sending ungated',
                        { automationId: ruleId }),
            });
        }
    };
}
