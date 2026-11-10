/**
 * Copy of collaborative documents from unpinned Durable Objects into their jurisdiction-pinned twins, in small resumable batches.
 *
 * A pinned namespace mints different ids from the unpinned one for the same name (see do-jurisdiction.ts), so each document's
 * stored state is exported from the old object and imported into the new one. Which documents exist is read from the database
 * (rows that carry stored collab state); object names are derived from the row's tenant and report, never from input. The old
 * object is never changed or deleted by this tool. It is asked to export, and `state-export` first stores whatever its open
 * sockets have sent (a persist), so an object with live editors does write its own storage and database row before answering.
 *
 * How it is run: `POST /api/platform/collab-migrate` (server/portal/collab-admin.routes.ts), on a deployment that exposes the
 * platform integration seam. It takes the same signed `x-portal-m2m` header as the other platform calls (see lib/m2m-auth.ts).
 * Body: `{ cursor?, limit?, dryRun?, replaceDerived? }`. `dryRun` defaults to TRUE and `replaceDerived` to false. Each call
 * handles at most `MAX_BATCH` documents (at most three object calls each, plus two database queries per call, so one call stays inside a
 * Worker's subrequest limit: about 32 normally, about 41 if a malformed row makes the batch database query fall back to one query per row) and answers with the counters below plus `nextCursor`; send it back as `cursor` until
 * `nextCursor` is null. Every call is safe to repeat.
 *
 * THE DATABASE CHECK. A document is not the only writer of `inspection_results.data`: photo, annotation, sync, sign and
 * re-inspection paths write it directly (some of them delete a photo or clear a value), and the next persist of a document
 * replaces the blob with the document's projection. So a copy never goes in unless the old document and the database AGREE
 * (`projectionsMatch`: findings only, every empty value alike, meta keys such as the signature not compared). A document that
 * lacks something the database gained would take it away on the next save; one that has something the database cleared would
 * bring it back. When they differ nothing is written and the row is a conflict with the reason `source-differs-from-database`;
 * an old document that cannot be decoded is `source-unreadable`, and a database row that cannot be parsed is
 * `database-row-unreadable` (one such row never stops the batch or the cursor). A dry run does not load the database, so these
 * conflicts appear only in a real run.
 *
 * SWITCH ORDER (read before turning `DO_JURISDICTION` on). A pinned object is EMPTY until migrated, and on the first request for a
 * report it rebuilds its document from the database with a NEW generation id. An unmigrated document that is opened therefore
 * starts a new lineage, older local copies can be merged into it, and content that the direct write paths (photos, signatures)
 * removed from the database can reappear.
 * The engine has NO switch that stops editing (no maintenance mode; the suspended-tenant check does not cover a WebSocket upgrade).
 * Keeping editors out is the operator's job, for example by taking the app offline at the edge for the window. A deploy usually
 * restarts the Durable Objects and drops open editor sockets, and editors reconnect on their own (usually; untested here, so try it
 * on staging first): a reconnect to a not-yet-migrated report creates exactly the object this order must avoid. So block traffic
 * to the Worker; do not rely on telling people to stay out.
 * Order: (1) the build must contain the lineage guard, live before any `replaceDerived`; (2) block traffic to the Worker;
 * (3) deploy with `DO_JURISDICTION` set; (4) dry run to the end and compare the sum of `total` over all pages with the number of
 * `inspection_results` rows that have `ydoc_state`; (5) `dryRun: false` until every document is migrated: per call, copied +
 * alreadyThere + empty + replaced + entries in `conflicts` + entries in `skipped` + entries in `failed` equals that call's `total`
 * (those three are lists; re-run a page with `failed`); (6) reopen. `replaceDerived` is only for rows reported `target-has-state` on
 * a target that still carries the `derived-from-d1` marker; `restoreBackupFor` undoes one such completed replacement.
 * The route answers 404 unless the deployment is the SaaS profile (`hasPortalIntegrationApi`); a standalone deployment runs
 * `listCollabDocRefs`, `loadResultsBlobs` and `migrateCollabDocs` from its own maintenance script. Authorization is the signed
 * `x-portal-m2m` header (the HMAC checked by `requireServiceBinding`).
 * Known limits: old unpinned objects keep their content after the copy until their inspection is deleted (nothing else cleans
 * them); deleting an inspection clears both namespaces for its report ids, best effort; changing `DO_JURISDICTION` later orphans
 * every pinned object; an orphan whose report row is gone is removable only by id through the platform purge route, which checks
 * that the tenant slug exists but not that the object belongs to that tenant.
 *
 * Operator procedure (once per deployment that turns `DO_JURISDICTION` on):
 *   1. Deploy with `DO_JURISDICTION` set. New documents are created in the pinned namespace from then on; the old namespace
 *      stays bound as `INSPECTION_DOC_UNPINNED` and is read by this copy and by deletion. Traffic must already be blocked (see SWITCH ORDER);
 *      keep it blocked until step 3 has finished.
 *   2. Page through once with `dryRun: true` (the default) and read the totals and `skipped`.
 *   3. Page through with `dryRun: false` until every document is migrated, then reopen editing. Read every list in the combined result:
 *      - `copied` and `alreadyThere` (the target already holds exactly the same document) need nothing more.
 *      - `empty`: the old object holds no document, so there was nothing to copy.
 *      - `conflicts`: the row was left alone. Each entry carries both object ids, both sizes and a `reason`:
 *        `source-differs-from-database`, `source-unreadable`, `database-row-unreadable` (see above), or a refusal from the
 *        target (`target-has-state`, `target-edited`, `target-unsaved`, `target-live`, `target-identity-mismatch`).
 *      - `skipped`: rows that cannot be copied safely (`no-report-id`: no object name can be derived; `identity-mismatch`: the
 *        object's stored identity names a different tenant, inspection or report than the row). Never guessed at.
 *      - `failed`: transport or storage errors, named; fix the cause and run again.
 *   4. A document opened in the pinned namespace before the copy ran was built from the database: it has the current values
 *      but none of the old object's editing history or restore points. To let the old copy win over such a target (reason
 *      `target-has-state`), page through again with `dryRun: false, replaceDerived: true`. What that DISCARDS is the target's own
 *      document AND its own restore points (`snapshots`), both of which the old copy replaces. It is protected twice: (a) the old
 *      document must agree with the database (above), so nothing the database holds is lost or resurrected; (b) the target
 *      must be not live (no open socket, nothing waiting to be stored), carry the stored identity of the same document, and
 *      still carry the `derived-from-d1` marker (set when the object built its document from the database, cleared by the
 *      first later change from anywhere), so no client edit is lost. The displaced DOCUMENT is kept in the object under
 *      `replaced-derived-backup` in the same atomic write as the replacement (the displaced restore points are not kept; the
 *      replacement's are), and each replacement logs one audit line with both ids, both sizes and the SHA-256 of both. That
 *      one write carries the document, the backup and the restore points together: a value over the 2 MB per-value limit makes
 *      it throw before anything is written, the row is reported `failed`, and such a document cannot be replaced.
 *      To undo one, send `{ restoreBackupFor: "<row id>" }` to the same route (it ignores `dryRun` by design: an explicit,
 *      separate write, refused if mixed with batch fields). The route loads the row's database blob and requires the BACKUP
 *      to agree with it (`backup-differs-from-database` otherwise), and the object refuses unless its stored document is still
 *      exactly the replacement (`target-edited` once any client edit persisted) and it is not live. On success it puts the
 *      backup back, marks it database-built again and spends the backup.
 *      A target a client has edited (`target-edited`), that is live (`target-live`) or that was evicted before its first save
 *      (`target-unsaved`) stays a conflict for a person to decide, and so does one with no marker, such as an object opened
 *      before the marker existed.
 *   5. Until `conflicts`, `skipped` and `failed` are empty or resolved, the old objects are the only copy of that history: leave
 *      them. Deletes keep reaching them through the old namespace either way.
 *
 * A legacy object that never stored its identity is copied with the identity the database row supplies; a stored identity is
 * kept, with the row's report id filled in when it has none, and only after it agrees with the row.
 *
 * Timing: an old object whose save alarm was armed before the deploy still runs it, and a save writes the old document's
 * projection to the database. That is harmless to the check (database and old document then agree), but an alarm that fires
 * between the check's database read and the import would leave the copy one save behind; wait a minute after deploying (the save alarm fires about one second after the last edit; a minute leaves room for retries) before
 * the real pass, and read `conflicts` after it.
 *
 * Not covered: `doc-lock-notify.ts` and `finding-key-migration.ts` address only the pinned `INSPECTION_DOC`, so a flush or a
 * finding-key rename never reaches an old unpinned object.
 */

import { and, asc, eq, gt, inArray, isNotNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { inspectionResults } from '../db/schema';
import { logger } from '../logger';
import type { ResultsProjection } from '@core/field-ui/shared/results-doc.types';
import { isNonEmptyProjection } from '../../durable-objects/results-divergence';
import { projectionsMatch, projectionOfBytes } from './projection-match';
import {
    base64ToBytes, type ImportRefusal, type ReplacedTarget, type StateExport, type TransferIdentity,
} from '../../durable-objects/inspection-doc-state-transfer';
import { collabDocName } from './doc-name';

/** Documents handled per call. At most three object calls each plus two database queries keeps one call near 32 subrequests. */
export const MAX_BATCH = 10;
export const DEFAULT_BATCH = 5;

/** One stored document as the database knows it. `reportId` is null only for a row from before reports existed. */
export interface CollabDocRef { rowId: string; tenantId: string; inspectionId: string; reportId: string | null }

interface MigrationConflict {
    /** The `inspection_results` row id: what the cursor and `restoreBackupFor` use. */
    rowId:        string;
    name:         string;
    tenantId:     string;
    inspectionId: string;
    reportId:     string;
    sourceId:     string;
    targetId:     string;
    sourceBytes:  number;
    targetBytes:  number;
    reason:       ImportRefusal | 'source-differs-from-database' | 'source-unreadable' | 'database-row-unreadable' | 'unknown';
}

type SkipReason = 'no-report-id' | 'identity-mismatch';
interface MigrationSkip { rowId: string; name: string; reason: SkipReason }

type RowOutcome = 'copied' | 'replaced' | 'alreadyThere' | 'empty' | 'conflict' | 'skipped' | 'failed' | 'wouldCopy';

/** One line per row handled in the batch: which row it was and what happened, so every outcome can be traced to a row id. */
interface MigrationRow { rowId: string; name: string; outcome: RowOutcome }

export interface MigrationReport {
    total:        number;
    copied:       number;
    /** Dry run only: documents that a real run would try to copy. */
    wouldCopy:    number;
    /** The target already holds exactly the document that would be copied. */
    alreadyThere: number;
    empty:        number;
    /** Targets that were only database-built and have been replaced by the old copy (each one audited). */
    replaced:     number;
    /** The target holds a different document that was not replaced. Nothing was written; an operator decides. */
    conflicts:    MigrationConflict[];
    skipped:      MigrationSkip[];
    failed:       string[];
    /** Every row of the batch with its row id and outcome (counters above only count). */
    rows:         MigrationRow[];
}

/** A row whose database blob could not be parsed. It is never guessed at: the row is reported and left alone. */
export const UNREADABLE = 'unreadable' as const;

/** What the database holds for a row: its projection, null when it holds nothing, or `UNREADABLE`. */
export type DatabaseBlob = ResultsProjection | null | typeof UNREADABLE;

/**
 * The results blob the database holds for each listed row, keyed by row id: one tenant-scoped query for the whole batch. A row
 * with no usable blob maps to null. A malformed row makes that query throw (the column is parsed as it is read), so the batch
 * is then read row by row and only the malformed rows map to `UNREADABLE`: one bad row cannot stop the cursor.
 */
export async function loadResultsBlobs(d1: D1Database, refs: CollabDocRef[]): Promise<Map<string, DatabaseBlob>> {
    const out = new Map<string, DatabaseBlob>();
    if (refs.length === 0) return out;
    const db = drizzle(d1);
    const columns = { id: inspectionResults.id, tenantId: inspectionResults.tenantId, data: inspectionResults.data };
    // The column's own type (a json value the driver parsed): narrowed by the guard, never cast.
    const usable = (data: typeof inspectionResults.$inferSelect['data'] | undefined): ResultsProjection | null => (isNonEmptyProjection(data) ? data : null);
    try {
        const rows = await db.select(columns).from(inspectionResults)
            .where(and(inArray(inspectionResults.id, refs.map((r) => r.rowId)), inArray(inspectionResults.tenantId, [...new Set(refs.map((r) => r.tenantId))])))
            .all();
        for (const ref of refs) out.set(ref.rowId, usable(rows.find((r) => r.id === ref.rowId && r.tenantId === ref.tenantId)?.data));
    } catch {
        for (const ref of refs) {
            try {
                const row = await db.select(columns).from(inspectionResults)
                    .where(and(eq(inspectionResults.id, ref.rowId), eq(inspectionResults.tenantId, ref.tenantId))).get();
                out.set(ref.rowId, usable(row?.data));
            } catch {
                out.set(ref.rowId, UNREADABLE);
            }
        }
    }
    return out;
}

export interface CollabDocPage { refs: CollabDocRef[]; nextCursor: string | null }

/**
 * One page of documents that have stored collab state, in row-id order. Reads ids only, never the state blob. A row without a
 * report id is kept so it can be reported. `nextCursor` is the id of the last row returned, or null when the listing is done.
 */
export async function listCollabDocRefs(d1: D1Database, opts: { limit: number; after?: string | null }): Promise<CollabDocPage> {
    const rows = await drizzle(d1)
        .select({ rowId: inspectionResults.id, tenantId: inspectionResults.tenantId, inspectionId: inspectionResults.inspectionId, reportId: inspectionResults.reportId })
        .from(inspectionResults)
        .where(opts.after ? and(isNotNull(inspectionResults.ydocState), gt(inspectionResults.id, opts.after)) : isNotNull(inspectionResults.ydocState))
        .orderBy(asc(inspectionResults.id))
        .limit(opts.limit + 1)
        .all();
    const refs = rows.slice(0, opts.limit);
    return { refs, nextCursor: rows.length > opts.limit ? (refs[refs.length - 1]?.rowId ?? null) : null };
}

/** What the copy needs from a namespace. A real `DurableObjectNamespace` is one (`Id` = `DurableObjectId`); so is a test double. */
export interface DocNamespace<Id> {
    idFromName(name: string): Id;
    get(id: Id): { fetch(url: string, init?: RequestInit): Promise<Response> };
}

interface RefusalBody { reason?: ImportRefusal }
interface ImportedBody { replaced?: ReplacedTarget | null }

const sizeOf = (ydoc: string | null): number => (ydoc ? base64ToBytes(ydoc).length : 0);

/** The identity the copy carries: the stored one with the row's report id filled in, or the row's own. Null when they disagree. */
function copiedIdentity(stored: TransferIdentity | null, ref: { tenantId: string; inspectionId: string; reportId: string }): TransferIdentity | null {
    if (!stored) return { tenantId: ref.tenantId, inspectionId: ref.inspectionId, reportId: ref.reportId };
    if (stored.tenantId !== ref.tenantId || stored.inspectionId !== ref.inspectionId) return null;
    if (stored.reportId != null && stored.reportId !== ref.reportId) return null;
    return { ...stored, reportId: stored.reportId ?? ref.reportId };
}

export async function migrateCollabDocs<Id>(
    refs: CollabDocRef[],
    from: DocNamespace<Id>,
    to: DocNamespace<Id>,
    opts: { dryRun: boolean; replaceDerived?: boolean; databaseBlob: (rowId: string) => DatabaseBlob },
): Promise<MigrationReport> {
    const report: MigrationReport = { total: refs.length, copied: 0, wouldCopy: 0, alreadyThere: 0, empty: 0, replaced: 0, conflicts: [], skipped: [], failed: [], rows: [] };
    const replaceDerived = opts.replaceDerived === true && !opts.dryRun;
    for (const { rowId, tenantId, inspectionId, reportId } of refs) {
        if (!reportId) {
            const orphan = `${tenantId}/inspection ${inspectionId}`;
            report.skipped.push({ rowId, name: orphan, reason: 'no-report-id' });
            report.rows.push({ rowId, name: orphan, outcome: 'skipped' });
            continue;
        }
        const name = collabDocName(tenantId, reportId);
        if (opts.dryRun) { report.wouldCopy++; report.rows.push({ rowId, name, outcome: 'wouldCopy' }); continue; }
        const row = (outcome: RowOutcome) => { report.rows.push({ rowId, name, outcome }); };
        try {
            const sourceId = from.idFromName(name);
            const targetId = to.idFromName(name);
            const conflict = (reason: MigrationConflict['reason'], sourceBytes: number, targetBytes: number) =>
                { report.conflicts.push({ rowId, name, tenantId, inspectionId, reportId, sourceId: String(sourceId), targetId: String(targetId), sourceBytes, targetBytes, reason }); row('conflict'); };
            const database = opts.databaseBlob(rowId);
            // A row the database check cannot read is never guessed at, and costs no object call.
            if (database === UNREADABLE) { conflict('database-row-unreadable', 0, 0); continue; }
            const exported = await from.get(sourceId).fetch('https://do.local/state-export');
            if (!exported.ok) { report.failed.push(`${name}: export returned ${exported.status}`); row('failed'); continue; }
            const source = await exported.json<StateExport>();
            if (source.ydoc === null) { report.empty++; row('empty'); continue; }
            const identity = copiedIdentity(source.identity, { tenantId, inspectionId, reportId });
            if (!identity) { report.skipped.push({ rowId, name, reason: 'identity-mismatch' }); row('skipped'); continue; }
            // The old document and the database must agree, or the next persist would take a direct write away (document behind the
            // database) or bring a deletion back (document ahead of it). A document that cannot be read fails closed.
            const sourceProjection = projectionOfBytes(base64ToBytes(source.ydoc));
            if (!sourceProjection || !projectionsMatch(sourceProjection, database)) {
                const held = await (await to.get(targetId).fetch('https://do.local/state-export')).json<StateExport>();
                conflict(sourceProjection ? 'source-differs-from-database' : 'source-unreadable', sizeOf(source.ydoc), sizeOf(held.ydoc));
                continue;
            }
            const res = await to.get(targetId).fetch('https://do.local/state-import', {
                method: 'POST',
                body: JSON.stringify({ ydoc: source.ydoc, identity, snapshots: source.snapshots, gen: source.gen ?? null, ...(replaceDerived ? { replaceDerived: true } : {}) }),
            });
            if (res.status === 409) {
                const refusal = await res.json<RefusalBody>();
                const held = await (await to.get(targetId).fetch('https://do.local/state-export')).json<StateExport>();
                if (held.ydoc === source.ydoc) { report.alreadyThere++; row('alreadyThere'); }
                else conflict(refusal.reason ?? 'unknown', sizeOf(source.ydoc), sizeOf(held.ydoc));
            } else if (res.ok) {
                const done = await res.json<ImportedBody>();
                if (done.replaced) {
                    report.replaced++;
                    row('replaced');
                    logger.info('collab migrate: replaced a database-built target with the old copy', {
                        rowId, name, tenantId, inspectionId, reportId, sourceId: String(sourceId), targetId: String(targetId),
                        sourceBytes: sizeOf(source.ydoc), targetBytes: done.replaced.previousBytes,
                        sourceSha256: done.replaced.newSha256, targetSha256: done.replaced.previousSha256,
                    });
                } else { report.copied++; row('copied'); }
            } else { report.failed.push(`${name}: import returned ${res.status}`); row('failed'); }
        } catch (e) {
            report.failed.push(`${name}: ${e instanceof Error ? e.message : 'unknown error'}`);
            row('failed');
        }
    }
    return report;
}

/** What undoing a replacement can answer. */
export type RestoreOutcome = 'restored' | 'no-backup' | 'live' | 'edited' | 'backup-differs-from-database' | 'database-row-unreadable' | 'failed';

interface BackupBody { ydoc: string }
interface RefusalName { error?: string }

/**
 * Put back the document a `replaceDerived` displaced, in the pinned object for one row.
 *
 * Two guards, both of which refuse without changing anything: the backup must still agree with the database (it was built
 * when the object opened, so a direct database write since then is not in it, and restoring it would take that write away on
 * the next save), and the object itself refuses unless the replacement is still untouched (no client edit has persisted since)
 * and it is not live. `databaseBlob` is what the database holds for the row, loaded by the caller. Only the displaced DOCUMENT
 * comes back: the target's restore points stay the replacement's, and the ones the replacement displaced are gone.
 */
export async function restoreDerivedBackup<Id>(ref: { tenantId: string; reportId: string }, to: DocNamespace<Id>, databaseBlob: DatabaseBlob): Promise<RestoreOutcome> {
    if (databaseBlob === UNREADABLE) return 'database-row-unreadable';
    const stub = to.get(to.idFromName(collabDocName(ref.tenantId, ref.reportId)));
    try {
        const info = await stub.fetch('https://do.local/state-backup');
        if (info.status === 404) return 'no-backup';
        if (!info.ok) return 'failed';
        const backupProjection = projectionOfBytes(base64ToBytes((await info.json<BackupBody>()).ydoc));
        if (!backupProjection || !projectionsMatch(backupProjection, databaseBlob)) return 'backup-differs-from-database';
        const res = await stub.fetch('https://do.local/state-restore-backup', { method: 'POST' });
        if (res.status === 404) return 'no-backup';
        if (res.status === 409) return (await res.json<RefusalName>()).error === 'target-edited' ? 'edited' : 'live';
        return res.ok ? 'restored' : 'failed';
    } catch {
        return 'failed';
    }
}
