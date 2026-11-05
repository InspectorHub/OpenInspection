import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { reportVersions } from './db/schema';
import type { Snapshot } from './version-diff';
import { chunkIds } from './id-chunks';
import { logger } from './logger';
import { resolveRenderedReportId } from '../services/inspection/report-grain';

/** One drizzle handle over D1, whatever schema it was built with (the repo's convention for helpers shared by several callers). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SnapshotDb = DrizzleD1Database<any>;

/**
 * Reading what a published report FROZE.
 *
 * Its own module rather than a private method on the report service, because it
 * belongs to the VERSION track, not the report-assembly track — and the service
 * it would otherwise sit in is already 900 lines of assembly.
 */

/**
 * The snapshot for one published version, or null.
 *
 * Null means the version could not be loaded (no such row, or the stored JSON does not parse; the second is
 * logged here). What to do about it is the CALLER's decision, and a caller serving a client must not answer
 * with the live tables instead: `getReportData` refuses. The lookup is exact on (tenant, inspection, report,
 * version), so it can never silently serve a DIFFERENT version.
 */
export async function loadPinnedSnapshot(
    db: SnapshotDb,
    tenantId: string,
    inspectionId: string,
    versionNumber: number,
    /**
     * The report the version belongs to. Version numbers run per REPORT, so on an order with two
     * deliverables "version 1" names two rows; the report id says which. A version published before
     * reports existed carries no report id and is the primary report's (`legacyIsMine`).
     */
    reportId?: string | null,
    legacyIsMine = true,
): Promise<Snapshot | null> {
    try {
        const row = await db.select({ snapshotJson: reportVersions.snapshotJson }).from(reportVersions)
            .where(and(
                reportVersionScope(tenantId, inspectionId, reportId ?? null, legacyIsMine),
                eq(reportVersions.versionNumber, versionNumber),
            ))
            // A row that names the report beats one that predates reports.
            .orderBy(sql`${reportVersions.reportId} is null`)
            .get();
        if (!row?.snapshotJson) return null;
        return JSON.parse(row.snapshotJson) as Snapshot;
    } catch (err) {
        // Not swallowed silently: the caller serving a client refuses to fall back to live data, and this is the
        // line that says why.
        logger.error('report snapshot could not be read', { tenantId, inspectionId, versionNumber }, err instanceof Error ? err : undefined);
        return null;
    }
}

/**
 * The versions that belong to one report. Version numbers and hash chains are per report, so every read of
 * "the versions of this report" carries this scope; without a report id it is the whole inspection.
 *
 * `legacyIsMine`: a version published before reports existed has no report id and belongs to the PRIMARY
 * report, so it is included for the primary report only.
 */
export function reportVersionScope(tenantId: string, inspectionId: string, reportId: string | null, legacyIsMine: boolean) {
    const base = and(eq(reportVersions.tenantId, tenantId), eq(reportVersions.inspectionId, inspectionId));
    if (!reportId) return base;
    return and(base, legacyIsMine
        ? or(eq(reportVersions.reportId, reportId), isNull(reportVersions.reportId))
        : eq(reportVersions.reportId, reportId));
}

/**
 * What a reader needs to know about a report's latest published version, without its snapshot.
 *
 * @declarationEmit Exported so the emitted `.d.ts` can NAME it: it is the return type of `loadLatestPublishedRef`.
 */
export interface PublishedVersionRef {
    versionNumber: number;
    contentHash: string | null;
    verificationToken: string | null;
    publishedAt: Date | null;
}

/**
 * The latest published version of one report, or null when it has none.
 *
 * Per REPORT: with no report id it is the PRIMARY report (what every client-facing read renders), never the
 * highest version across all the order's reports. The two differ the moment a second deliverable has more
 * versions than the first, and a pin taken from the wrong report names a version the rendered report does not
 * have. An inspection with no reports row at all falls back to its highest version.
 */
export async function loadLatestPublishedRef(
    db: SnapshotDb,
    tenantId: string,
    inspectionId: string,
    reportId?: string | null,
): Promise<PublishedVersionRef | null> {
    const primary = await resolveRenderedReportId(db, tenantId, inspectionId);
    const rid = reportId ?? primary;
    const row = await db.select({
        versionNumber:     reportVersions.versionNumber,
        contentHash:       reportVersions.contentHash,
        verificationToken: reportVersions.verificationToken,
        publishedAt:       reportVersions.publishedAt,
    }).from(reportVersions)
        .where(reportVersionScope(tenantId, inspectionId, rid, rid === primary))
        .orderBy(desc(reportVersions.versionNumber)).limit(1).get();
    return row ? { ...row, publishedAt: row.publishedAt ?? null } : null;
}

/** The 1 MB ceiling on one stored snapshot (D1 rows are bytes, not characters). */
export const MAX_SNAPSHOT_BYTES = 1024 * 1024;

/** The stored size of a snapshot: UTF-8 bytes, which is what a D1 row counts. */
export function snapshotByteLength(snapshotJson: string): number {
    return new TextEncoder().encode(snapshotJson).length;
}

/**
 * The findings and the template of one inspection as its latest published version froze them.
 *
 * @declarationEmit Exported so the emitted `.d.ts` can NAME it: it is the value type of `loadLatestFrozenFindings`.
 */
export interface FrozenFindings {
    data: Record<string, unknown>;
    templateSnapshot: unknown;
}

/** Rows per query: each id also binds its company, and D1 allows 100 parameters per statement. */
const FROZEN_FINDINGS_CHUNK = 40;

/**
 * The latest published version's findings for each of the given inspections, keyed `tenantId:inspectionId`.
 * An inspection with no version is simply absent: the caller keeps its live rows for exactly those.
 *
 * It is the PRIMARY report's version (a version with no report id predates reports and is the primary's),
 * the report a client and an agent mean by "the report", with the highest version number counted within that
 * report alone: a second deliverable with more versions must not decide which snapshot is read.
 *
 * Only the two parts a listing reads are extracted inside the database, so a list of inspections does not
 * pull every whole snapshot (up to 1 MB each) into the worker. The tenant filter is part of the query because
 * a listing may span companies; the keys carry the tenant so rows never meet across companies.
 */
export async function loadLatestFrozenFindings(
    db: SnapshotDb,
    inspections: ReadonlyArray<{ id: string; tenantId: string }>,
): Promise<Map<string, FrozenFindings>> {
    const out = new Map<string, FrozenFindings>();
    const primaryOf = (versionTable: string) =>
        `(select r.id from reports r where r.tenant_id = ${versionTable}.tenant_id and r.inspection_id = ${versionTable}.inspection_id and r.kind = 'primary')`;
    for (const ids of chunkIds(inspections.map((i) => i.id), FROZEN_FINDINGS_CHUNK)) {
        const wanted = new Set(ids);
        const tenantIds = [...new Set(inspections.filter((i) => wanted.has(i.id)).map((i) => i.tenantId))];
        const rows = await db.select({
            inspectionId: reportVersions.inspectionId,
            tenantId: reportVersions.tenantId,
            versionNumber: reportVersions.versionNumber,
            data: sql<string | null>`json_extract(${reportVersions.snapshotJson}, '$.data')`,
            templateSnapshot: sql<string | null>`json_extract(${reportVersions.snapshotJson}, '$.inspection.templateSnapshot')`,
        }).from(reportVersions).where(and(
            inArray(reportVersions.tenantId, tenantIds),
            inArray(reportVersions.inspectionId, ids),
            sql`(${reportVersions.reportId} is null or ${reportVersions.reportId} = ${sql.raw(primaryOf('report_versions'))})`,
            sql`${reportVersions.versionNumber} = (select max(v.version_number) from report_versions v where v.tenant_id = ${reportVersions.tenantId} and v.inspection_id = ${reportVersions.inspectionId} and (v.report_id is null or v.report_id = ${sql.raw(primaryOf('v'))}))`,
        )).orderBy(sql`${reportVersions.reportId} is null`).all();
        for (const row of rows) {
            const key = `${row.tenantId}:${row.inspectionId}`;
            if (out.has(key) || typeof row.data !== 'string') continue;
            try {
                out.set(key, {
                    data: JSON.parse(row.data) as Record<string, unknown>,
                    templateSnapshot: typeof row.templateSnapshot === 'string' ? JSON.parse(row.templateSnapshot) : null,
                });
            } catch (err) {
                // An unreadable snapshot is not a frozen copy: the live rows stand in for this one inspection.
                logger.error('frozen findings could not be read', { tenantId: row.tenantId, inspectionId: row.inspectionId }, err instanceof Error ? err : undefined);
            }
        }
    }
    return out;
}

/** Snapshot fields that name a stored file. */
const FILE_KEY_FIELDS = new Set(['key', 'annotatedKey', 'croppedKey', 'posterKey', 'streamUid', 'mediaId']);

/** Most versions of one inspection read at once; an inspection has a handful. */
const MAX_VERSIONS_SCANNED = 200;

/** Every stored-file key a results document names (original, annotated, cropped, video, poster), added to `into`. */
export function collectFileKeys(node: unknown, into: Set<string>): void {
    if (Array.isArray(node)) { for (const item of node) collectFileKeys(item, into); return; }
    if (node === null || typeof node !== 'object') return;
    for (const [name, value] of Object.entries(node)) {
        if (typeof value === 'string') { if (FILE_KEY_FIELDS.has(name) && value) into.add(value); }
        else collectFileKeys(value, into);
    }
}

/**
 * Every stored file the published versions of an inspection refer to: photos (original, annotated, cropped),
 * videos (stored key, poster, stream id) and the cover. A frozen report and its PDFs show these exactly as published, so they must
 * outlive any later edit of the working copy.
 *
 * ALL versions, not only the latest: an earlier version stays verifiable (its page and frozen PDF are
 * re-rendered from its own snapshot), and the signed record would otherwise lose its pictures the day it is
 * superseded. One narrow read: the findings and the two cover fields, extracted inside the database. Used by
 * the orphan sweep (which must not reap them) and by the pool-photo delete (which must refuse).
 */
export async function loadFrozenFileKeys(db: SnapshotDb, tenantId: string, inspectionId: string): Promise<Set<string>> {
    const rows = await db.select({
        data: sql<string | null>`json_extract(${reportVersions.snapshotJson}, '$.data')`,
        coverImageKey: sql<string | null>`json_extract(${reportVersions.snapshotJson}, '$.inspection.coverImageKey')`,
        coverPhotoId: sql<string | null>`json_extract(${reportVersions.snapshotJson}, '$.inspection.coverPhotoId')`,
    }).from(reportVersions)
        .where(and(eq(reportVersions.tenantId, tenantId), eq(reportVersions.inspectionId, inspectionId)))
        .limit(MAX_VERSIONS_SCANNED).all();
    const keys = new Set<string>();
    for (const row of rows) {
        if (row.coverImageKey) keys.add(row.coverImageKey);
        if (row.coverPhotoId) keys.add(row.coverPhotoId);
        if (typeof row.data !== 'string') continue;
        try { collectFileKeys(JSON.parse(row.data), keys); }
        catch (err) {
            // The files of a version we cannot read are unknown, so none of this inspection's files may be reaped on
            // the strength of an incomplete list: the caller must treat this as a failure.
            throw new Error(`snapshot data of inspection ${inspectionId} is unreadable`, { cause: err });
        }
    }
    return keys;
}
