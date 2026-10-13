/**
 * Offline import for the collaborative results document.
 *
 * A native client that worked without a connection holds a Yjs update the
 * server has never seen. This applies it to the live document, behind a
 * mandatory snapshot, and reports a status the caller can act on. The Durable
 * Object only wires `snapshot` and `persist` in; everything that decides the
 * outcome is here so it can be reasoned about, and tested, in one place.
 */

import * as Y from 'yjs';
import { logger } from '../lib/logger';

/**
 * Transaction origin for imported updates. It is deliberately NOT one of the
 * skip-origins in the object's update handler: an import is a real change, so
 * it is broadcast to connected editors, persisted, and counted toward the
 * automatic snapshot cadence.
 */
export const IMPORT_ORIGIN: unique symbol = Symbol('collab-import-origin');

/**
 * Largest update accepted, in bytes. The route enforces it before reading the
 * body and the object enforces it again, because the object is the persistence
 * boundary and must not trust that every caller went through the route.
 */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export type ImportFailure =
    /** Empty, malformed, or truncated bytes. */
    | { ok: false; status: 400; reason: 'empty' | 'malformed' }
    /** Larger than MAX_IMPORT_BYTES. */
    | { ok: false; status: 413; reason: 'too_large' }
    /** Well-formed, but it builds on history this document does not have, so part of it would be held back unapplied. */
    | { ok: false; status: 422; reason: 'unmet_dependencies' }
    /** The pre-import snapshot could not be written, so nothing was applied. */
    | { ok: false; status: 503; reason: 'snapshot_failed' };

/**
 * `changed` is false when the update left the document exactly as it was (a
 * repeat of an earlier import, or a retry). `snapshotSeq` is then the newest
 * existing import snapshot, or null when there is none, because no snapshot
 * was taken for this call.
 */
export type ImportResult = { ok: true; snapshotSeq: number | null; changed: boolean } | ImportFailure;

/** Sequence number of the newest import snapshot among `snapshots`, or null when there is none. */
export function newestImportSeq(snapshots: readonly { seq: number; reason?: string }[]): number | null {
    let seq: number | null = null;
    for (const snap of snapshots) {
        if (snap.reason === 'import' && (seq === null || snap.seq > seq)) seq = snap.seq;
    }
    return seq;
}

/** What a document has parked because it could not integrate it yet. */
interface PendingState {
    structsBytes: number;
    missing: Map<number, number>;
    dsBytes: number;
}

function pendingOf(doc: Y.Doc): PendingState {
    const structs = doc.store.pendingStructs;
    const ds = doc.store.pendingDs;
    return {
        structsBytes: structs ? structs.update.byteLength : 0,
        missing: structs ? new Map(structs.missing) : new Map(),
        dsBytes: ds ? ds.byteLength : 0,
    };
}

/**
 * True when applying the update parked MORE than the copy already had parked.
 * The copy inherits whatever the live document has not been able to integrate
 * (`encodeStateAsUpdate` folds pending data in), so "anything pending" would
 * refuse every import once the live document had a gap of its own. What matters
 * is only what this update added: a new missing dependency, or more parked bytes.
 */
function parkedMore(before: PendingState, after: PendingState): boolean {
    if (after.dsBytes > before.dsBytes) return true;
    if (after.structsBytes > before.structsBytes) return true;
    for (const [client, clock] of after.missing) {
        const was = before.missing.get(client);
        if (was === undefined || clock > was) return true;
    }
    return false;
}

/**
 * Prove an update applies cleanly WITHOUT touching the live document.
 *
 * `Y.applyUpdate` is not atomic. It integrates the structs it has decoded and
 * only then reads the delete set, so an update cut one byte short throws after
 * its content is already in the document (verified against the library, and
 * pinned by a test). Trying the update on a throwaway copy first means a throw
 * can only ever happen where it is harmless; a copy and the live document hold
 * the same state, so an update that applies to one applies to the other.
 *
 * An update whose causal dependencies are missing does not throw either: Yjs
 * parks the unreachable part in `pendingStructs`/`pendingDs` and reports
 * success. That would answer 200 for a bundle that was only partly applied, and
 * the client would discard its copy, so it is refused instead. Only what the
 * update itself parks counts; a gap the live document already had is not the
 * caller's fault.
 *
 * Also reports whether the update changes anything. `Y.snapshot` is the state
 * vector plus a delete set derived from the struct store, so comparing the
 * copy's snapshot with the live one sees an update that only deletes (which
 * leaves the state vector alone) as a change.
 */
export function trialApply(doc: Y.Doc, update: Uint8Array): { ok: true; changed: boolean } | ImportFailure {
    const trial = new Y.Doc();
    try {
        Y.applyUpdate(trial, Y.encodeStateAsUpdate(doc));
        const before = pendingOf(trial);
        Y.applyUpdate(trial, update);
        if (parkedMore(before, pendingOf(trial))) {
            return { ok: false, status: 422, reason: 'unmet_dependencies' };
        }
        return { ok: true, changed: !Y.equalSnapshots(Y.snapshot(trial), Y.snapshot(doc)) };
    } catch {
        return { ok: false, status: 400, reason: 'malformed' };
    } finally {
        trial.destroy();
    }
}

/**
 * Apply an offline client's Yjs update.
 *
 * Order matters and is the contract:
 *   1. Validate on a copy. A bad update costs nothing: no snapshot slot (the
 *      ring keeps 25, so garbage must not be able to push real history out) and
 *      no change to the document.
 *   2. An update that changes nothing (a repeat, or a retry after a failed
 *      persist) takes no snapshot and applies nothing: a snapshot of an
 *      unchanged state would only push real history out of the ring, and on a
 *      retry would bury the genuine "before the import" snapshot under one that
 *      already contains it.
 *   3. Take the pre-import snapshot. It must succeed. An import that cannot be
 *      undone is refused, which is the opposite of the fail-open connect
 *      snapshot on purpose.
 *   4. Apply to the live document. The snapshot reads the document, then writes
 *      under the object's input gate, which holds back other events while that
 *      storage operation is pending, so the snapshot is a consistent past state
 *      of the document. An edit that races in between the snapshot and the apply
 *      is merged by Yjs either way.
 */
export async function applyImport(
    doc: Y.Doc,
    update: Uint8Array,
    snapshot: () => Promise<{ seq: number }>,
    latestImportSeq: () => Promise<number | null>,
): Promise<ImportResult> {
    if (update.byteLength === 0) return { ok: false, status: 400, reason: 'empty' };
    if (update.byteLength > MAX_IMPORT_BYTES) return { ok: false, status: 413, reason: 'too_large' };

    const trial = trialApply(doc, update);
    if (!trial.ok) return trial;
    if (!trial.changed) return { ok: true, snapshotSeq: await latestImportSeq(), changed: false };

    let seq: number;
    try {
        seq = (await snapshot()).seq;
    } catch {
        return { ok: false, status: 503, reason: 'snapshot_failed' };
    }

    Y.applyUpdate(doc, update, IMPORT_ORIGIN);
    return { ok: true, snapshotSeq: seq, changed: true };
}

/**
 * The Durable Object's `/import` answer: apply, persist, and say what happened.
 *
 * A failed persist is a 503, not a swallowed error. The update is already in the
 * live document and the object's debounced persist retries it, but the caller
 * must not be told "done" before it is durable. Retrying is safe: the retry is
 * judged against the in-memory document, which already holds the update, so it
 * reports no change and takes no second snapshot, but it still persists, so a 200
 * always means durable.
 */
export async function importResponse(
    doc: Y.Doc,
    update: Uint8Array,
    snapshot: () => Promise<{ seq: number }>,
    persist: () => Promise<void>,
    latestImportSeq: () => Promise<number | null>,
): Promise<Response> {
    const out = await applyImport(doc, update, snapshot, latestImportSeq);
    if (!out.ok) return Response.json({ ok: false, reason: out.reason }, { status: out.status });
    try {
        await persist();
    } catch (err) {
        logger.error('collab: persist after import failed', {}, err instanceof Error ? err : undefined);
        return Response.json({ ok: false, reason: 'persist_failed' }, { status: 503 });
    }
    return Response.json({ ok: true, snapshotSeq: out.snapshotSeq, changed: out.changed });
}
