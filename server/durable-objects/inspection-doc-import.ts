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

export type ImportResult = { ok: true; snapshotSeq: number } | ImportFailure;

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
 * the client would discard its copy, so it is refused instead.
 */
function trialApply(doc: Y.Doc, update: Uint8Array): ImportFailure | null {
    const trial = new Y.Doc();
    try {
        Y.applyUpdate(trial, Y.encodeStateAsUpdate(doc));
        Y.applyUpdate(trial, update);
        if (trial.store.pendingStructs !== null || trial.store.pendingDs !== null) {
            return { ok: false, status: 422, reason: 'unmet_dependencies' };
        }
        return null;
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
 *   2. Take the pre-import snapshot. It must succeed. An import that cannot be
 *      undone is refused, which is the opposite of the fail-open connect
 *      snapshot on purpose.
 *   3. Apply to the live document. The snapshot projects the document right
 *      after its storage read and then writes under the object's input gate, which
 *      holds back other events while a storage operation is pending; the apply
 *      follows synchronously. So the snapshot is the state the import landed on,
 *      and an edit that races in is merged by Yjs either way.
 *
 * Re-importing the same bytes is safe: Yjs integrates a struct once, so a repeat
 * changes nothing. It does take another snapshot, which is the price of never
 * having to decide whether an import was "the same one".
 */
export async function applyImport(
    doc: Y.Doc,
    update: Uint8Array,
    snapshot: () => Promise<{ seq: number }>,
): Promise<ImportResult> {
    if (update.byteLength === 0) return { ok: false, status: 400, reason: 'empty' };
    if (update.byteLength > MAX_IMPORT_BYTES) return { ok: false, status: 413, reason: 'too_large' };

    const rejected = trialApply(doc, update);
    if (rejected) return rejected;

    let seq: number;
    try {
        seq = (await snapshot()).seq;
    } catch {
        return { ok: false, status: 503, reason: 'snapshot_failed' };
    }

    Y.applyUpdate(doc, update, IMPORT_ORIGIN);
    return { ok: true, snapshotSeq: seq };
}

/**
 * The Durable Object's `/import` answer: apply, persist, and say what happened.
 *
 * A failed persist is a 503, not a swallowed error. The update is already in the
 * live document and the object's debounced persist retries it, but the caller
 * must not be told "done" before it is durable. Retrying is safe because a
 * repeat of the same update changes nothing.
 */
export async function importResponse(
    doc: Y.Doc,
    update: Uint8Array,
    snapshot: () => Promise<{ seq: number }>,
    persist: () => Promise<void>,
): Promise<Response> {
    const out = await applyImport(doc, update, snapshot);
    if (!out.ok) return Response.json({ ok: false, reason: out.reason }, { status: out.status });
    try {
        await persist();
    } catch (err) {
        logger.error('collab: persist after import failed', {}, err instanceof Error ? err : undefined);
        return Response.json({ ok: false, reason: 'persist_failed' }, { status: 503 });
    }
    return Response.json({ ok: true, snapshotSeq: out.snapshotSeq });
}
