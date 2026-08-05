/**
 * Reads over the `reports` entity.
 *
 * One order can deliver several documents — a standard report and a radon
 * report — so "the report" is only ever a well-defined phrase once you say
 * WHICH. This module is where callers that still address things by inspection
 * resolve that.
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { inspectionResults, reports, reportVersions } from '../db/schema';
import { Errors } from '../errors';
import { logger } from '../logger';
import { safeISODate } from '../date';
import { REPORT_STATUS, isReportPublished } from '../status/report-status';

/**
 * Every deliverable on one order, in the order a person would read them.
 *
 * `sort_order` first, `created_at` second: generation writes several rows in the
 * same millisecond, so a timestamp alone leaves the list to whatever the
 * database happened to return — and "which report is the standard one" is not a
 * question the UI should answer differently on two page loads.
 */
export async function listReports(
    db: DrizzleD1Database,
    tenantId: string,
    inspectionId: string,
): Promise<Array<typeof reports.$inferSelect>> {
    return db.select().from(reports)
        .where(and(eq(reports.tenantId, tenantId), eq(reports.inspectionId, inspectionId)))
        .orderBy(asc(reports.sortOrder), asc(reports.createdAt))
        .all();
}

/**
 * The primary report of an inspection, or null when it has none.
 *
 * Null is a real answer, not an error: an inspection whose report row has not
 * been created yet has nothing to open, and callers must fail closed rather
 * than fall back to an inspection-keyed document — that fallback is exactly the
 * shared-Y.Doc corruption this entity exists to prevent.
 */
export async function resolvePrimaryReportId(
    db: DrizzleD1Database,
    tenantId: string,
    inspectionId: string,
): Promise<string | null> {
    const row = await db.select({ id: reports.id }).from(reports)
        .where(and(
            eq(reports.tenantId, tenantId),
            eq(reports.inspectionId, inspectionId),
            eq(reports.kind, 'primary'),
        ))
        .get();
    return row?.id ?? null;
}

/**
 * Give an inspection its PRIMARY report.
 *
 * The minimum slice of report generation, not the whole of it: one report per
 * SOLD SERVICE is separate work. What has to hold now is that a primary report
 * always exists, because the collab route resolves an inspection to its primary
 * and fails CLOSED when there is none — correct, since the alternative is
 * falling back to an inspection-keyed document, which is the shared-Y.Doc bug,
 * but it means an inspection without one cannot be edited at all.
 *
 * Non-fatal by design. Both callers have already written the canonical
 * `inspections` row, and throwing here would lose it over a row that a backfill
 * can add later.
 *
 * Returns the new report's id, or null when the insert failed. Callers need it:
 * the `inspection_results` row born alongside it must carry `report_id`, and a
 * results row left NULL is invisible rather than loud — `uq_results_report` is a
 * unique index on a nullable column, so SQLite permits any number of NULLs, and
 * every read that asks "which document belongs to this report" silently matches
 * nothing or matches a sibling.
 */
export async function createPrimaryReport(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: any,
    tenantId: string,
    inspectionId: string,
    templateId: string | null,
): Promise<string | null> {
    const id = crypto.randomUUID();
    try {
        await db.insert(reports).values({
            id,
            tenantId,
            inspectionId,
            kind: 'primary',
            inspectionServiceId: null,
            templateId,
            title: 'Inspection Report',
            // The constant, not the literal — the status-literal gate exists
            // because a hand-typed status bypasses the type layer, which is how
            // ghost values reach runtime. `reports.status` is a narrower axis
            // than REPORT_STATUS (no 'submitted'), but 'in_progress' means the
            // same thing on both and they must not drift apart.
            status: REPORT_STATUS.IN_PROGRESS,
            createdAt: new Date(),
        });
        return id;
    } catch (err) {
        logger.error('primary report create failed', { inspectionId },
            err instanceof Error ? err : undefined);
        return null;
    }
}

/**
 * Why a report may not be deleted, or null when it may.
 *
 * ONE function, because whether an actor may do something is decided where it
 * is ENFORCED and merely read by the UI — a page that re-derives the rule can
 * offer a button the API refuses. The delete endpoint and the hub payload both
 * call this.
 *
 * - `primary`: every order must keep one. The collab route resolves an
 *   inspection to its primary and fails CLOSED without one, so deleting it does
 *   not remove a document — it makes the whole order uneditable.
 * - `published`: it has been delivered. A published report owns `report_versions`
 *   rows carrying `content_hash`/`prev_hash`/`signature` — tamper-evidence a
 *   client can check through the public verifier — and a link somebody already
 *   holds. Deleting that is not "removing a draft", it is destroying the
 *   evidence that the delivered document is the one we signed.
 */
export type ReportDeleteBlock = 'primary' | 'published';

export function reportDeleteBlock(
    report: Pick<typeof reports.$inferSelect, 'kind' | 'status'>,
): ReportDeleteBlock | null {
    if (report.kind === 'primary') return 'primary';
    if (isReportPublished(report.status)) return 'published';
    return null;
}

/** One deliverable, shaped for the order page's report list. */
export interface ReportListItem {
    id: string;
    kind: 'primary' | 'ancillary';
    title: string;
    status: string;
    publishedAt: string | null;
    /** Published versions this report owns — part of what a delete would destroy. */
    versionCount: number;
    /** True when its document has been written into: the "information you already filled out". */
    hasContent: boolean;
    canDelete: boolean;
    deleteBlockedReason: ReportDeleteBlock | null;
}

/**
 * The order's deliverables, with everything the list and its delete
 * confirmation need — and nothing else.
 *
 * Deliberately projects columns rather than `select()`: `inspection_results`
 * carries `ydoc_state`, a Yjs binary blob per report, and an aggregate payload
 * that drags several of those across the wire to decide whether to render a
 * bullet is a page that gets slower with every report sold.
 */
export async function listReportsForHub(
    db: DrizzleD1Database,
    tenantId: string,
    inspectionId: string,
): Promise<ReportListItem[]> {
    const rows = await listReports(db, tenantId, inspectionId);
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);

    const versionRows = await db.select({
        reportId: reportVersions.reportId,
        count: sql<number>`count(*)`,
    }).from(reportVersions)
        .where(and(eq(reportVersions.tenantId, tenantId), inArray(reportVersions.reportId, ids)))
        .groupBy(reportVersions.reportId)
        .all();
    const versionCounts = new Map(versionRows.map((v) => [v.reportId, Number(v.count)]));

    // `data` is the projected findings map, small next to `ydoc_state`; its
    // emptiness is what "you already filled this out" actually means.
    const resultRows = await db.select({
        reportId: inspectionResults.reportId,
        data: inspectionResults.data,
    }).from(inspectionResults)
        .where(and(eq(inspectionResults.tenantId, tenantId), inArray(inspectionResults.reportId, ids)))
        .all();
    const written = new Set(
        resultRows
            .filter((r) => {
                const parsed = typeof r.data === 'string' ? JSON.parse(r.data) as unknown : r.data;
                return !!parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0;
            })
            .map((r) => r.reportId),
    );

    return rows.map((r) => {
        const blocked = reportDeleteBlock(r);
        return {
            id: r.id,
            kind: r.kind,
            title: r.title,
            status: r.status,
            publishedAt: safeISODate(r.publishedAt) ?? null,
            versionCount: versionCounts.get(r.id) ?? 0,
            hasContent: written.has(r.id),
            canDelete: blocked === null,
            deleteBlockedReason: blocked,
        };
    });
}

/**
 * Delete one report and everything that belongs only to it.
 *
 * The one irreversible action in this feature. A report is not a row: it owns
 * an `inspection_results` document (the findings AND the Yjs state two people
 * may have been typing into) and its own `report_versions` chain. There are no
 * foreign keys by policy, so delete-ordering is this function's responsibility
 * and nothing else will notice the orphans it leaves.
 *
 * The BILLING LINE stays. `inspection_services` is what the client was charged
 * for; deleting the deliverable does not un-sell the work, and the invoice is
 * authoritative over the line sum regardless.
 */
export async function deleteReport(
    db: DrizzleD1Database,
    tenantId: string,
    inspectionId: string,
    reportId: string,
): Promise<void> {
    const row = await db.select().from(reports)
        .where(and(
            eq(reports.id, reportId),
            eq(reports.tenantId, tenantId),
            eq(reports.inspectionId, inspectionId),
        ))
        .get();
    if (!row) throw Errors.NotFound('Report not found');

    const blocked = reportDeleteBlock(row);
    if (blocked === 'primary') {
        throw Errors.Conflict(
            'The primary report cannot be deleted. Every order keeps one, and without it the order cannot be edited at all.',
        );
    }
    if (blocked === 'published') {
        throw Errors.Conflict(
            'A published report cannot be deleted. It has been delivered, and its signed versions are what let a client verify the document they hold.',
        );
    }

    await db.delete(inspectionResults)
        .where(and(eq(inspectionResults.tenantId, tenantId), eq(inspectionResults.reportId, reportId)));
    await db.delete(reportVersions)
        .where(and(eq(reportVersions.tenantId, tenantId), eq(reportVersions.reportId, reportId)));
    await db.delete(reports)
        .where(and(eq(reports.id, reportId), eq(reports.tenantId, tenantId)));

    logger.info('report deleted', { inspectionId, reportId, title: row.title });
}
