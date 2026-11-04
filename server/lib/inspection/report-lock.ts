/**
 * Whether a report's CONTENT may be written: the one rule behind "published means published".
 *
 * A published report is what clients read, frozen at its latest version. Its content may not change silently,
 * so every write to it is refused (409 `REPORT_PUBLISHED`) until the inspector chooses "Edit and republish".
 *
 * ## The rule
 *
 * Per report, from the two columns that already exist on `reports`:
 *
 * | `status`      | `published_at` | state       | content writes | clients see                       |
 * |---------------|----------------|-------------|----------------|-----------------------------------|
 * | `published`   | set            | `published` | REFUSED (while the order is `published` too) | the latest version |
 * | `in_progress` | set            | `editing`   | allowed        | the latest version (still frozen) |
 * | `in_progress` | null           | `draft`     | allowed        | nothing (never published, or retracted) |
 *
 * - PUBLISH sets `published` and stamps `published_at` (`markReportPublished`).
 * - EDIT AND REPUBLISH sets `in_progress` and keeps `published_at`: the report is "out" and being edited again.
 *   The order stays `published`. A report row left `published` by an older retract, whose ORDER is back in draft, is not locked.
 * - RETRACT sets `in_progress` and clears `published_at`: the report is withdrawn, links expire.
 *
 * Which report: the one the route addresses, and for an inspection-addressed route the PRIMARY report, which is
 * also the document the collaborative editor opens. An inspection with no `reports` row at all (not yet
 * backfilled) falls back to the order's `report_status`.
 *
 * Only `status = 'published'` locks. A report that is merely `submitted` (awaiting review) is not published.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { inspections, reports } from '../db/schema';
import { Errors } from '../errors';
import { isReportPublished, REPORT_STATUS } from '../status/report-status';

export type ReportEditState = 'draft' | 'published' | 'editing';

/** The state of one report, from its own row. */
export function reportEditState(report: { status: string; publishedAt: Date | null | undefined }): ReportEditState {
    if (isReportPublished(report.status)) return 'published';
    return report.publishedAt ? 'editing' : 'draft';
}

/**
 * The lock rule as a pure predicate, so that everything which needs to know (the write guards, and the editor deciding
 * whether to open read-only) answers from one place. `status` is null/undefined when the order has no report row at all:
 * then the order's own status is the only record there is.
 */
export function isContentLocked(row: { status?: string | null; publishedAt?: Date | null; orderStatus: string | null | undefined }): boolean {
    if (row.status == null) return isReportPublished(row.orderStatus);
    return reportEditState({ status: row.status, publishedAt: row.publishedAt }) === 'published' && isReportPublished(row.orderStatus);
}

/**
 * True when a write to this report's content must be refused.
 *
 * Both records must say "published": the report's own row AND the order's `report_status`. Retract used to reset only the
 * order, so older retracted reports still carry `reports.status = 'published'` with their order back in draft; they
 * are drafts, and the second condition is what keeps them unlocked without a data migration. "Edit and republish"
 * keeps the order `published` and moves only the report, so a report being edited again is unlocked by the first.
 */
export async function isReportContentLocked(
    db: DrizzleD1Database,
    tenantId: string,
    inspectionId: string,
    /** Absent = the primary report. */
    reportId?: string | null,
): Promise<boolean> {
    const row = await db.select({ status: reports.status, publishedAt: reports.publishedAt, orderStatus: inspections.reportStatus })
        .from(reports)
        .innerJoin(inspections, and(eq(inspections.id, reports.inspectionId), eq(inspections.tenantId, reports.tenantId)))
        .where(and(
            eq(reports.tenantId, tenantId),
            eq(reports.inspectionId, inspectionId),
            reportId ? eq(reports.id, reportId) : eq(reports.kind, 'primary'),
        )).get();
    if (row) return isContentLocked(row);
    // No report row to ask: the order's own status is the only record there is.
    const insp = await db.select({ reportStatus: inspections.reportStatus }).from(inspections)
        .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId))).get();
    return isReportPublished(insp?.reportStatus);
}

/** Throws 409 `REPORT_PUBLISHED` when the report's content is locked. */
export async function assertReportContentWritable(
    db: DrizzleD1Database,
    tenantId: string,
    inspectionId: string,
    reportId?: string | null,
): Promise<void> {
    if (await isReportContentLocked(db, tenantId, inspectionId, reportId)) throw Errors.ReportPublished(inspectionId);
}

/**
 * The inspections among `targets` whose report is published, in one read. For a writer that names several
 * inspections at once (the offline package import), where one query beats one per inspection.
 */
export async function lockedInspectionIds(
    db: DrizzleD1Database,
    tenantId: string,
    targets: ReadonlyArray<{ inspectionId: string; reportId: string }>,
): Promise<string[]> {
    if (targets.length === 0) return [];
    const rows = await db.select({ id: reports.id, status: reports.status, orderStatus: inspections.reportStatus }).from(reports)
        .innerJoin(inspections, and(eq(inspections.id, reports.inspectionId), eq(inspections.tenantId, reports.tenantId)))
        .where(and(eq(reports.tenantId, tenantId), inArray(reports.id, targets.map((t) => t.reportId)))).all();
    // Same rule as `isReportContentLocked`: the report AND its order must both say published (`publishedAt` does not
    // change that answer, which only reads `status`).
    const published = new Set(rows.filter((r) => isContentLocked({ status: r.status, orderStatus: r.orderStatus })).map((r) => r.id));
    return targets.filter((t) => published.has(t.reportId)).map((t) => t.inspectionId);
}

/**
 * Puts a report that was being edited back to `published` without a new version: the inspector republished and
 * nothing had changed, so the version clients read is still current and only the lock needs restoring.
 */
export async function relockUnchangedReport(
    db: DrizzleD1Database,
    tenantId: string,
    inspectionId: string,
    reportId?: string | null,
): Promise<void> {
    await db.update(reports).set({ status: REPORT_STATUS.PUBLISHED })
        .where(and(
            eq(reports.tenantId, tenantId),
            eq(reports.inspectionId, inspectionId),
            reportId ? eq(reports.id, reportId) : eq(reports.kind, 'primary'),
        ));
}
