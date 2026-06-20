import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import { automations, inspections, agreementRequests, inspectionServices } from '../../lib/db/schema';
import { logger } from '../../lib/logger';
import { isReportPublished } from '../../lib/status/report-status';
import { type Constructor } from './shared';
import type { AutomationBase } from './shared';

/**
 * Conditions mixin: send-time gate evaluation (Track J D4). Returns a skip reason
 * when a gate fails so flush() (delivery mixin) can mark the log 'skipped'. Body
 * is byte-identical to the former monolith.
 */
export function AutomationConditions<TBase extends Constructor<AutomationBase>>(Base: TBase) {
    return class extends Base {
        /**
         * Track J (D4) — evaluate a rule's send-time gates against the CURRENT world.
         * Returns a skip reason when a gate fails so flush() can mark the log 'skipped'.
         * Track L — SMS gating (consent/credentials) now lives per-channel in flush(),
         * NOT here; this evaluates channel-agnostic conditions only.
         */
        // Public (was `private` on the monolith) so the delivery mixin's flush() can
        // call it through a typed cross-mixin contract; no runtime behavior change.
        async evaluateConditions(
            db: DrizzleD1Database,
            automation: typeof automations.$inferSelect,
            inspection: typeof inspections.$inferSelect,
        ): Promise<{ ok: true } | { ok: false; reason: string }> {
            // Track J (D7) — a reminder enqueued for an inspection that has since
            // reached a terminal status (cancelled/completed/delivered/published) is
            // stale; suppress it (e.g. don't send "don't forget tomorrow" for a
            // cancelled inspection). NOTE: a reschedule to a DIFFERENT date is a known
            // v1 limitation — the reminder still fires at the originally-computed time,
            // because we don't currently mutate reminder logs when an inspection's date
            // changes. event_id has no unique index on purpose: Spec 4D reminder+follow-up
            // logs intentionally share an inspection-event id, so the cron's
            // check-then-insert dedup (safe because CF cron runs are effectively serial)
            // is the chosen guard rather than a DB unique constraint.
            if (automation.trigger === 'inspection.reminder' &&
                (inspection.status === 'cancelled' || inspection.status === 'completed' ||
                 isReportPublished(inspection.reportStatus))) {
                return { ok: false, reason: 'inspection no longer active' };
            }
            if (!automation.conditions) return { ok: true };

            let cond: { requirePaid?: boolean; requireSigned?: boolean; serviceIds?: string[] };
            try {
                cond = JSON.parse(automation.conditions);
            } catch {
                // Malformed JSON → fail OPEN (treat as no gates) so a corrupt blob
                // doesn't trap the log in 'pending' forever. Warn so the ungated send
                // is observable (conditions are app-serialized, so this implies a bug
                // or manual DB edit). Never log the blob contents.
                logger.warn('AutomationService.evaluateConditions: malformed conditions JSON, sending ungated',
                    { automationId: automation.id });
                return { ok: true };
            }

            if (cond.requirePaid && inspection.paymentStatus !== 'paid') {
                return { ok: false, reason: 'condition: not paid' };
            }
            if (cond.requireSigned) {
                const signed = await db.select({ id: agreementRequests.id }).from(agreementRequests)
                    .where(and(
                        eq(agreementRequests.tenantId, inspection.tenantId),
                        eq(agreementRequests.inspectionId, inspection.id),
                        eq(agreementRequests.status, 'signed'),
                    )).limit(1);
                if (signed.length === 0) return { ok: false, reason: 'condition: agreement not signed' };
            }
            if (cond.serviceIds && cond.serviceIds.length > 0) {
                const rows = await db.select({ serviceId: inspectionServices.serviceId }).from(inspectionServices)
                    .where(eq(inspectionServices.inspectionId, inspection.id));
                const have = new Set(rows.map(r => r.serviceId));
                if (!cond.serviceIds.some(id => have.has(id))) {
                    return { ok: false, reason: 'condition: service not matched' };
                }
            }
            return { ok: true };
        }
    };
}
