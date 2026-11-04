/**
 * What a client sees of an inspection's report, and whether the inspector is editing it again: DERIVED, never stored.
 *
 * `publishedVersionNumber` is the latest signed version of the PRIMARY report while that report is out (the order's
 * `report_status` is `published`), and null otherwise: a draft, or a report that was retracted (its versions remain, but
 * clients see none of them). A published order whose primary report has no row yet (it is created on demand by "Edit and
 * republish") is still published: it reports the order's latest version and is not being edited again. `editingAgain` is true while a published report is open for "Edit and republish": clients keep
 * reading `publishedVersionNumber`, and the inspector has unpublished edits. There is no status value for it; the pair is
 * read off `reports` and `report_versions` (see `./report-lock` for the states).
 *
 * One bounded read for the ids a page shows (chunked under D1's bound-parameter limit), tenant-scoped, never one per row.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { inspections, reports } from '../db/schema';
import { chunkIds } from '../id-chunks';
import { isReportPublished } from '../status/report-status';
import { isContentLocked, reportEditState } from './report-lock';

export interface PublishedState {
    /** The version clients read, or null when clients see no version. */
    publishedVersionNumber: number | null;
    /** True while a published report is open for editing again. */
    editingAgain: boolean;
}

/** `PublishedState` plus the write lock for the same report, from the SAME predicate the write guards use. */
export interface PublishedStateWithLock extends PublishedState {
    /** True when a write to the primary report's content is refused (409 `REPORT_PUBLISHED`). */
    contentLocked: boolean;
}

/** The state of an inspection nobody has published, or that does not exist. */
export const NOT_PUBLISHED: PublishedState = { publishedVersionNumber: null, editingAgain: false };

/**
 * The latest version number of a report, as SQL: the one definition every surface uses (list, dashboard, detail, hub).
 * A version published before reports existed carries no report id and is the primary report's.
 */
export function latestVersionSql() {
    return sql<number | null>`(select max(v.version_number) from report_versions v where v.tenant_id = ${inspections.tenantId} and (v.report_id = ${reports.id} or (v.report_id is null and v.inspection_id = ${inspections.id})))`;
}

async function readStates(db: DrizzleD1Database, tenantId: string, inspectionIds: readonly string[]): Promise<Map<string, PublishedStateWithLock>> {
    const out = new Map<string, PublishedStateWithLock>();
    for (const ids of chunkIds(inspectionIds)) {
        // Left join: an order with no primary report row yet is still an order whose own status says published.
        const rows = await db.select({
            id: inspections.id,
            orderStatus: inspections.reportStatus,
            status: reports.status,
            publishedAt: reports.publishedAt,
            latest: latestVersionSql(),
        }).from(inspections)
            .leftJoin(reports, and(eq(reports.inspectionId, inspections.id), eq(reports.tenantId, inspections.tenantId), eq(reports.kind, 'primary')))
            .where(and(eq(inspections.tenantId, tenantId), inArray(inspections.id, ids)))
            .all();
        for (const r of rows) {
            const published = isReportPublished(r.orderStatus);
            out.set(r.id, {
                publishedVersionNumber: published && r.latest != null ? Number(r.latest) : null,
                editingAgain: published && r.status != null && reportEditState({ status: r.status, publishedAt: r.publishedAt }) === 'editing',
                contentLocked: isContentLocked(r),
            });
        }
    }
    return out;
}

/** One bounded read for the ids a page shows. Ids that are not this tenant's inspections are absent from the map. */
export async function loadPublishedStates(
    db: DrizzleD1Database,
    tenantId: string,
    inspectionIds: readonly string[],
): Promise<Map<string, PublishedState>> {
    const out = new Map<string, PublishedState>();
    for (const [id, { publishedVersionNumber, editingAgain }] of await readStates(db, tenantId, inspectionIds)) out.set(id, { publishedVersionNumber, editingAgain });
    return out;
}

/** The same read for one inspection, with the write lock: the editor opens read-only exactly when the server would refuse a write. */
export async function loadPublishedStateWithLock(db: DrizzleD1Database, tenantId: string, inspectionId: string): Promise<PublishedStateWithLock> {
    return (await readStates(db, tenantId, [inspectionId])).get(inspectionId) ?? { ...NOT_PUBLISHED, contentLocked: false };
}
