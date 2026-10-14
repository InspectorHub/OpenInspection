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
import { replacePhotoByPendingId } from '../lib/collab/results-doc';
import type { PhotoEntry } from '../lib/collab/results-doc.types';

/**
 * Transaction origin for imported updates. It is deliberately NOT one of the
 * skip-origins in the object's update handler: an import is a real change, so
 * it is broadcast to connected editors, persisted, and counted toward the
 * automatic snapshot cadence.
 */
const IMPORT_ORIGIN: unique symbol = Symbol('collab-import-origin');

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
type ImportResult = { ok: true; snapshotSeq: number | null; changed: boolean } | ImportFailure;

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
async function applyImport(
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

// ─── Resolving pending photo entries ─────────────────────────────────────────
//
// A photo captured offline sits in the document as `pendingUpload: true` with a
// `pendingId` and no key. A connected client swaps it for the real R2 key once
// the upload lands (`resolvePendingPhoto`). An offline bundle is imported with
// no client online, so the server performs the same swap, with the same
// `replacePhotoByPendingId`, from a map the caller built.

/** Most pendingId to key pairs one call may carry. */
export const MAX_PENDING_ENTRIES = 1000;
/** Largest request body, in characters, accepted before it is parsed. */
const MAX_PENDING_BODY_CHARS = 512 * 1024;

const PENDING_ID = /^[A-Za-z0-9_-]{1,64}$/;
const KEY_CHARS = /^[A-Za-z0-9_./-]+$/;
const MAX_KEY_CHARS = 512;

export type ResolvePendingFailure =
    | { ok: false; status: 400; reason: 'invalid_body' | 'invalid_pending_id' | 'invalid_key' }
    | { ok: false; status: 413; reason: 'too_many_entries' | 'too_large' }
    /** The swap threw on the trial copy, so the live document was not touched. */
    | { ok: false; status: 500; reason: 'apply_failed' }
    | { ok: false; status: 503; reason: 'persist_failed' };

/** The identity an object is addressed with; every key must sit under this tenant and inspection. */
export interface PendingScope { tenantId: string; inspectionId: string }

/** The only R2 prefix a resolved photo may point into. */
function photoKeyPrefix(scope: PendingScope): string {
    return `${scope.tenantId}/inspections/${scope.inspectionId}/photos/`;
}

/**
 * Validate a pendingId to key map against the object's own identity, without
 * trusting its shape. Returns a Map so a hostile id such as `__proto__` is just a key.
 */
export function validatePendingMap(raw: unknown, scope: PendingScope): { ok: true; map: Map<string, string> } | ResolvePendingFailure {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, status: 400, reason: 'invalid_body' };
    const entries = Object.entries(raw);
    if (entries.length > MAX_PENDING_ENTRIES) return { ok: false, status: 413, reason: 'too_many_entries' };
    const prefix = photoKeyPrefix(scope);
    const map = new Map<string, string>();
    for (const [pendingId, key] of entries) {
        if (!PENDING_ID.test(pendingId)) return { ok: false, status: 400, reason: 'invalid_pending_id' };
        const safe = typeof key === 'string' && key.length > prefix.length && key.length <= MAX_KEY_CHARS
            && key.startsWith(prefix) && !key.includes('..') && KEY_CHARS.test(key);
        if (!safe) return { ok: false, status: 400, reason: 'invalid_key' };
        map.set(pendingId, key);
    }
    return { ok: true, map };
}

/**
 * Replace every `pendingUpload` photo entry whose `pendingId` is in `map` with
 * the same entry carrying the real key and none of the pending markers. One
 * transaction, so connected editors get a single update.
 */
export function resolvePendingKeys(doc: Y.Doc, map: ReadonlyMap<string, string>): { matched: number; unmatched: number; changed: boolean } {
    const targets: { findingKey: string; pendingId: string; entry: PhotoEntry }[] = [];
    const resolvedIds = new Set<string>();
    const results = doc.getMap<unknown>('results');
    results.forEach((item, findingKey) => {
        const photos = item instanceof Y.Map ? item.get('photos') : undefined;
        if (!(photos instanceof Y.Array)) return;
        photos.forEach((el: unknown) => {
            if (!(el instanceof Y.Map) || el.get('pendingUpload') !== true) return;
            const pendingId = el.get('pendingId');
            const key = typeof pendingId === 'string' ? map.get(pendingId) : undefined;
            if (typeof pendingId !== 'string' || key === undefined) return;
            const entry: PhotoEntry = { ...el.toJSON(), key };
            delete entry.pendingUpload;
            delete entry.pendingId;
            delete entry.pendingKind;
            targets.push({ findingKey, pendingId, entry });
            resolvedIds.add(pendingId);
        });
    });
    if (targets.length > 0) {
        doc.transact(() => {
            for (const t of targets) replacePhotoByPendingId(doc, t.findingKey, t.pendingId, t.entry);
        }, IMPORT_ORIGIN);
    }
    return { matched: targets.length, unmatched: map.size - resolvedIds.size, changed: targets.length > 0 };
}

/**
 * The Durable Object's `/resolve-pending` answer. Yjs does not roll a
 * transaction back when it throws, so the swap is rehearsed on a throwaway copy
 * first; the live document is only touched by a run already proven to complete.
 * No snapshot is taken: the swap is mechanical, replayable from the same map,
 * and the bundle import that precedes it already took the "before" snapshot.
 */
export async function resolvePendingResponse(
    doc: Y.Doc,
    body: string,
    identity: { tenantId: string | null; inspectionId: string | null },
    persist: () => Promise<void>,
): Promise<Response> {
    const fail = (f: ResolvePendingFailure): Response => Response.json({ ok: false, reason: f.reason }, { status: f.status });
    const { tenantId, inspectionId } = identity;
    if (!tenantId || !inspectionId) return Response.json({ ok: false, reason: 'missing_identity' }, { status: 400 });
    const scope: PendingScope = { tenantId, inspectionId };
    if (body.length > MAX_PENDING_BODY_CHARS) return fail({ ok: false, status: 413, reason: 'too_large' });
    let raw: unknown;
    try {
        raw = JSON.parse(body);
    } catch {
        return fail({ ok: false, status: 400, reason: 'invalid_body' });
    }
    const checked = validatePendingMap(raw, scope);
    if (!checked.ok) return fail(checked);

    const trial = new Y.Doc();
    try {
        Y.applyUpdate(trial, Y.encodeStateAsUpdate(doc));
        resolvePendingKeys(trial, checked.map);
    } catch {
        return fail({ ok: false, status: 500, reason: 'apply_failed' });
    } finally {
        trial.destroy();
    }

    const out = resolvePendingKeys(doc, checked.map);
    try {
        await persist();
    } catch (err) {
        logger.error('collab: persist after resolving pending photos failed', {}, err instanceof Error ? err : undefined);
        return fail({ ok: false, status: 503, reason: 'persist_failed' });
    }
    return Response.json({ ok: true, ...out });
}
