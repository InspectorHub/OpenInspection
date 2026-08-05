/**
 * Per-report publish bookkeeping, and the rule that stops it spamming.
 *
 * One order, several reports — but not several "your report is ready" emails.
 *
 * A standard inspection and a sewer scope finished in the same sitting are ONE
 * delivery as far as the client is concerned, and charging them two
 * notifications for it is the most visible way this feature could make the
 * product worse than the single-report version it replaces. A radon report
 * published two days later is the opposite case: announcing itself is the whole
 * reason the client waited.
 *
 * The line between those is time, so that is what this module measures.
 */
import { and, desc, eq, isNotNull, ne } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { reports } from '../db/schema';
import { Errors } from '../errors';
import { resolvePrimaryReportId } from './reports';
import { REPORT_STATUS } from '../status/report-status';

/**
 * How long after a report notification a SIBLING report's publish is treated as
 * part of the same delivery.
 *
 * One hour. Short enough that a genuinely later deliverable still announces
 * itself, long enough to cover an inspector wrapping up a job and publishing
 * the documents one after another — which in practice is minutes apart, not
 * hours. It is a window on the NOTIFICATION, not on the publish: a report
 * published inside the window is still published, still versioned and still
 * signed; only the second announcement is suppressed.
 */
export const REPORT_NOTIFY_COALESCE_WINDOW_MS = 60 * 60 * 1000;

/**
 * Which deliverable a publish is about.
 *
 * A caller-supplied id is re-resolved inside this tenant AND this inspection: a
 * report id is the only part of a publish payload that names a row, so it is the
 * only part that can publish somebody else's document. Omitted, it means the
 * order's primary report — what every caller predating multi-report delivery
 * intends. Null comes back only when the order has no primary at all, which the
 * publish path treats as "nothing per-report to record" rather than an error.
 */
export async function resolvePublishTargetReport(
    db: DrizzleD1Database,
    tenantId: string,
    inspectionId: string,
    reportId?: string,
): Promise<string | null> {
    if (!reportId) return resolvePrimaryReportId(db, tenantId, inspectionId);
    const owned = await db.select({ id: reports.id }).from(reports)
        .where(and(
            eq(reports.id, reportId),
            eq(reports.tenantId, tenantId),
            eq(reports.inspectionId, inspectionId),
        ))
        .get();
    if (!owned) throw Errors.NotFound('Report not found');
    return owned.id;
}

/**
 * Record that THIS deliverable shipped.
 *
 * `inspections.report_status` stays the order-wide roll-up every existing reader
 * consumes; it cannot say which document shipped or when, which is exactly the
 * question a client waiting on one of several is asking.
 */
export async function markReportPublished(
    db: DrizzleD1Database, tenantId: string, reportId: string, now: Date,
): Promise<void> {
    await db.update(reports)
        .set({ status: REPORT_STATUS.PUBLISHED, publishedAt: now })
        .where(and(eq(reports.id, reportId), eq(reports.tenantId, tenantId)));
}

/** Record that this deliverable's publish is the one that told people. */
export async function markReportNotified(
    db: DrizzleD1Database, tenantId: string, reportId: string, now: Date,
): Promise<void> {
    await db.update(reports).set({ notifiedAt: now })
        .where(and(eq(reports.id, reportId), eq(reports.tenantId, tenantId)));
}

/** Pure decision, so the window can be tested without a database. */
export function shouldCoalesceNotification(
    lastSiblingNotifiedAtMs: number | null,
    nowMs: number,
    windowMs: number = REPORT_NOTIFY_COALESCE_WINDOW_MS,
): boolean {
    if (lastSiblingNotifiedAtMs == null) return false;
    const elapsed = nowMs - lastSiblingNotifiedAtMs;
    // A negative elapsed (clock skew, a stamp from the future) is not evidence
    // of a recent delivery — coalescing on it would silently drop a real one.
    return elapsed >= 0 && elapsed <= windowMs;
}

/**
 * When another report on this order last actually notified anyone.
 *
 * Excludes the report being published: republishing one document is an
 * amendment to it, not a second announcement of a sibling, and letting it
 * suppress itself would mean an amended report never told anyone it changed.
 */
export async function lastSiblingNotifiedAt(
    db: DrizzleD1Database,
    tenantId: string,
    inspectionId: string,
    exceptReportId: string,
): Promise<number | null> {
    const row = await db.select({ notifiedAt: reports.notifiedAt }).from(reports)
        .where(and(
            eq(reports.tenantId, tenantId),
            eq(reports.inspectionId, inspectionId),
            ne(reports.id, exceptReportId),
            isNotNull(reports.notifiedAt),
        ))
        .orderBy(desc(reports.notifiedAt))
        .limit(1)
        .get();
    return row?.notifiedAt ? row.notifiedAt.getTime() : null;
}
