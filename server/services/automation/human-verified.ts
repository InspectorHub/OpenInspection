import { and, eq, isNull, like } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { automationLogs } from '../../lib/db/schema';
import { logger } from '../../lib/logger';
import type { HumanVerifier } from '../../lib/email/outbound-cooling-window';

/**
 * A person who passed the human check while publishing has vouched for the
 * report emails that publish queued, including ones a rule delays: those are
 * sent later with no request around to carry a token. Stamp the still-pending
 * email rows of THIS inspection so the delivery path sends them at their due
 * time instead of deferring them to the end of the cooling window.
 *
 * Only called after `humanVerified()` resolved true, so a request without a
 * valid token stamps nothing. Scoped by tenant and inspection, pending email
 * rows only, and never overwrites an earlier stamp.
 */
async function stampHumanVerifiedLogs(
    db: DrizzleD1Database<Record<string, unknown>>,
    tenantId: string,
    inspectionId: string,
    now: number = Date.now(),
): Promise<void> {
    await db.update(automationLogs)
        .set({ humanVerifiedAt: new Date(now) })
        .where(and(
            eq(automationLogs.tenantId, tenantId),
            eq(automationLogs.inspectionId, inspectionId),
            eq(automationLogs.channel, 'email'),
            eq(automationLogs.status, 'pending'),
            // Only what THIS publish queued: the report.published rules' rows. Delayed
            // reminders or follow-ups queued by anything else are not vouched for.
            like(automationLogs.eventId, 'auto:report.published:%'),
            isNull(automationLogs.humanVerifiedAt),
        ));
}

/** The route-facing form: only when the request's token verifies, and never fatal. */
export async function stampIfHumanVerified(
    humanVerified: HumanVerifier | undefined,
    db: DrizzleD1Database<Record<string, unknown>>,
    tenantId: string,
    inspectionId: string,
): Promise<void> {
    if (!humanVerified || !(await humanVerified())) return;
    await stampHumanVerifiedLogs(db, tenantId, inspectionId).catch((e: unknown) =>
        logger.warn('human-verified stamp failed (non-fatal)', { inspectionId, error: String(e) }));
}
