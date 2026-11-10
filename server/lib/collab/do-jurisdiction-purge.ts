/**
 * Removal of the old (unpinned) Durable Object for each document that has been copied into the jurisdiction-pinned namespace.
 *
 * The copy (do-jurisdiction-migrate.ts) never changes the old object, so until this step runs the old object keeps the document,
 * and the personal data in it, in its original region. This is the separate, explicit, verified step that removes it.
 *
 * It never copies anything. For each row it reads both objects and deletes the OLD object only when all of these hold:
 *   - the old object holds a document whose stored identity (if any) agrees with the row, and it is not live;
 *   - the pinned object holds exactly the same document bytes (so nothing in the old object is lost);
 *   - the pinned object is not live (no open sockets, nothing waiting to be stored), carries the stored identity of the same
 *     document, was not merely rebuilt from the database, and, when the old object recorded a lineage id, carries that same id.
 * Anything that is not provably safe is `kept` with a fixed reason code and nothing is touched. A read that fails is `failed`,
 * never a purge. The pinned object is never deleted: the purge verb is only ever sent to the old object's stub.
 *
 * The delete is the existing purge verb with the expected-tenant header (purge-path.ts), the tenant coming from the database
 * row. The object checks it against the identity it stored: another tenant's object, or a document with no stored identity,
 * answers 403 and nothing is deleted (reported as `kept`).
 *
 * Idempotent: an old object that already holds no document is `alreadyPurged`. A dry run reports what a real run would try
 * (`wouldPurge`) without addressing any object. Nothing in the report or its log line carries document content or tenant
 * names; rows are identified by the row id.
 *
 * Operating order: migrate, verify the migration report, THEN purge (dry run first). See docs/operate/durable-object-jurisdiction.md.
 */

import { PURGE_IF_IDLE_HEADER, PURGE_IF_SNAPSHOTS_HEADER, PURGE_IF_YDOC_HEADER, PURGE_TENANT_HEADER, purgeDigest, purgeSnapshotsDigest } from '../../durable-objects/purge-path';
import { base64ToBytes, type ImportedSnapshot, type StateExport } from '../../durable-objects/inspection-doc-state-transfer';
import { collabDocName } from './doc-name';
import { copiedIdentity, type CollabDocRef, type DocNamespace } from './do-jurisdiction-migrate';

export type KeptReason =
    | 'no-report-id'
    | 'identity-mismatch'
    | 'source-live'
    | 'source-changed'
    | 'target-empty'
    | 'target-differs'
    | 'target-live'
    | 'target-identity-mismatch'
    | 'target-derived'
    | 'target-lineage-differs'
    | 'source-not-attributable'
    | 'source-partial'
    | 'target-snapshots-differ';

export type FailedReason = 'source-export-failed' | 'target-export-failed' | 'purge-failed' | 'malformed-export' | 'error';

type PurgeOutcome = 'purged' | 'alreadyPurged' | 'kept' | 'failed' | 'wouldPurge';

export interface PurgeRow { rowId: string; outcome: PurgeOutcome; reason?: KeptReason | FailedReason }

export interface PurgeReport {
    total:         number;
    purged:        number;
    /** The old object already holds no document (an earlier run, or nothing was ever stored). */
    alreadyPurged: number;
    /** Dry run only: rows a real run would examine and, if all checks pass, purge. Nothing was addressed. */
    wouldPurge:    number;
    kept:          { rowId: string; reason: KeptReason }[];
    /** `kept` counted per reason. */
    keptByReason:  Partial<Record<KeptReason, number>>;
    failed:        { rowId: string; reason: FailedReason }[];
    /** Every row of the batch with its outcome. purged + alreadyPurged + wouldPurge + kept + failed equals total. */
    rows:          PurgeRow[];
}

const EXPORT_URL = 'https://do.local/state-export';

const isStringOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string';

/** Structural equality of two parsed JSON values (restore points are plain JSON). */
function sameJson(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) return false;
    const ka = Object.keys(a);
    if (ka.length !== Object.keys(b).length) return false;
    return ka.every((k) => k in b && sameJson(Reflect.get(a, k), Reflect.get(b, k)));
}

/** True when every restore point of `source` is present, unchanged, in `target` (matched by seq). The target may hold more. */
function snapshotsCovered(source: ImportedSnapshot[], target: ImportedSnapshot[]): boolean {
    return source.every((s) => target.some((t) => t.seq === s.seq && sameJson(s, t)));
}

/** Why the pinned object is not provably the same, finished, copy of the old one. Null when it is. */
function targetVerdict(source: StateExport, target: StateExport, ref: { tenantId: string; inspectionId: string; reportId: string }): KeptReason | null {
    if (target.ydoc === null) return 'target-empty';
    if (target.live !== false) return 'target-live'; // unknown counts as live
    if (target.ydoc !== source.ydoc) return 'target-differs';
    const held = target.identity;
    if (!held || held.tenantId !== ref.tenantId || held.inspectionId !== ref.inspectionId || (held.reportId ?? null) !== ref.reportId) return 'target-identity-mismatch';
    // A database-built target is not a copy: it is only trusted when the old document was database-built too.
    if (target.derivedFromD1 === true && source.derivedFromD1 !== true) return 'target-derived';
    // The copy carries the old object's lineage id; a different id means the target started a new history.
    if (source.gen !== null && target.gen !== source.gen) return 'target-lineage-differs';
    // The restore points travel with the copy: the pinned object must still hold every one of the old object's.
    if (!Array.isArray(target.snapshots) || !snapshotsCovered(source.snapshots, target.snapshots)) return 'target-snapshots-differ';
    return null;
}

export async function purgeMigratedSources<Id>(
    refs: CollabDocRef[],
    from: DocNamespace<Id>,
    to: DocNamespace<Id>,
    opts: { dryRun: boolean },
): Promise<PurgeReport> {
    const report: PurgeReport = { total: refs.length, purged: 0, alreadyPurged: 0, wouldPurge: 0, kept: [], keptByReason: {}, failed: [], rows: [] };
    const keep = (rowId: string, reason: KeptReason) => {
        report.kept.push({ rowId, reason });
        report.keptByReason[reason] = (report.keptByReason[reason] ?? 0) + 1;
        report.rows.push({ rowId, outcome: 'kept', reason });
    };
    const fail = (rowId: string, reason: FailedReason) => { report.failed.push({ rowId, reason }); report.rows.push({ rowId, outcome: 'failed', reason }); };
    for (const { rowId, tenantId, inspectionId, reportId } of refs) {
        if (!reportId) { keep(rowId, 'no-report-id'); continue; }
        if (opts.dryRun) { report.wouldPurge++; report.rows.push({ rowId, outcome: 'wouldPurge' }); continue; }
        // Failure texts are fixed codes: an exception message could carry object or tenant detail.
        let stage: FailedReason = 'source-export-failed';
        try {
            const name = collabDocName(tenantId, reportId);
            const sourceStub = from.get(from.idFromName(name));
            const sourceRes = await sourceStub.fetch(EXPORT_URL);
            if (!sourceRes.ok) { fail(rowId, 'source-export-failed'); continue; }
            const source = await sourceRes.json<StateExport>();
            if (!isStringOrNull(source.ydoc) || !Array.isArray(source.snapshots)) { fail(rowId, 'malformed-export'); continue; }
            if (source.ydoc === null) {
                // Empty only when nothing at all is left: a stored identity or restore points without a document is a partial object.
                if (source.identity === null && source.snapshots.length === 0) { report.alreadyPurged++; report.rows.push({ rowId, outcome: 'alreadyPurged' }); } else keep(rowId, 'source-partial');
                continue;
            }
            if (source.live !== false) { keep(rowId, 'source-live'); continue; }
            if (!copiedIdentity(source.identity, { tenantId, inspectionId, reportId })) { keep(rowId, 'identity-mismatch'); continue; }
            stage = 'target-export-failed';
            const targetRes = await to.get(to.idFromName(name)).fetch(EXPORT_URL);
            if (!targetRes.ok) { fail(rowId, 'target-export-failed'); continue; }
            const target = await targetRes.json<StateExport>();
            if (!isStringOrNull(target.ydoc)) { fail(rowId, 'malformed-export'); continue; }
            const verdict = targetVerdict(source, target, { tenantId, inspectionId, reportId });
            if (verdict) { keep(rowId, verdict); continue; }
            stage = 'purge-failed';
            // The tenant is the row's, never the caller's; the object checks it against the identity it stored.
            // Compare-and-delete: the object deletes only if its stored document still has the digest of the one read above.
            const digest = await purgeDigest(base64ToBytes(source.ydoc));
            const purged = await sourceStub.fetch('https://do.local/purge', { method: 'POST', headers: { [PURGE_TENANT_HEADER]: tenantId, [PURGE_IF_IDLE_HEADER]: '1', [PURGE_IF_YDOC_HEADER]: digest, [PURGE_IF_SNAPSHOTS_HEADER]: await purgeSnapshotsDigest(source.snapshots) } });
            if (purged.status === 409) {
                const why = (await purged.json<{ error?: string }>().catch(() => ({ error: 'live' }))).error;
                if (why === 'bad-precondition') fail(rowId, 'purge-failed'); // never sent by this code: a version mismatch, not a safe state
                else keep(rowId, why === 'changed' ? 'source-changed' : 'source-live'); // live, or changed since it was read
                continue;
            }
            if (purged.status === 403) { keep(rowId, 'source-not-attributable'); continue; }
            if (!purged.ok) { fail(rowId, 'purge-failed'); continue; }
            report.purged++;
            report.rows.push({ rowId, outcome: 'purged' });
        } catch {
            fail(rowId, stage === 'purge-failed' ? 'purge-failed' : 'error');
        }
    }
    return report;
}
