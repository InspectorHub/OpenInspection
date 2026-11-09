/**
 * The client half of the results document's lineage guard.
 *
 * The server names the history its document holds with a random id (the generation) and sends it as the FIRST frame of every
 * socket. A browser whose offline store was written against another generation holds a history the server cannot merge
 * (two independent Yjs histories do not combine: per finding, the whole item of one wins by client id), so the connection
 * discards that store instead of handing it back. See `server/durable-objects/inspection-doc-generation.ts` for the server half
 * and the wire format; the literals below are duplicated from it (there is no shared package, keep the two in sync).
 *
 * What the guard can and cannot do:
 *  - A store that recorded no generation (every store written before this existed) ADOPTS the server's: it cannot be judged,
 *    so it is trusted once. The first deploy therefore protects only stores created or re-synced afterwards.
 *  - A server that never sends the frame (an older deploy) is recognised by its first frame being a sync frame: the server
 *    always sends the generation before the handshake, and a socket keeps order. Nothing is judged and nothing is written.
 *  - A discarded store is kept in ONE backup slot (overwritten by the next discard) so support can recover offline edits.
 */

import * as Y from 'yjs';
import * as decoding from 'lib0/decoding';

/** Framing byte of the generation frame (mirrors `MSG_GENERATION` in the Durable Object module). */
export const MSG_GENERATION = 4;

/** Which generations are meant by a stored and a served id. */
export type LineageVerdict = 'adopt' | 'keep' | 'discard';

/** Why a store was discarded, for the backup slot and the log line. */
export interface DiscardedStoreInfo {
    storedGen: string;
    serverGen: string;
}

/** Host-supplied, per inspection: where the generation and the one-slot backup of a discarded store live (IndexedDB on the web). */
export interface ResultsDocLineageStore {
    /** The generation this device's store was last in sync with, or null when none was recorded. */
    read(): Promise<string | null>;
    /** Record the generation. Best-effort: a failure must not wedge the connection. */
    write(gen: string): Promise<void>;
    /** Keep the discarded store's full state in the single backup slot. Best-effort. */
    saveDiscarded(update: Uint8Array, info: DiscardedStoreInfo): Promise<void>;
}

/** Host factory, one store per inspection id. */
export type ResultsDocLineageFactory = (inspectionId: string) => ResultsDocLineageStore;

/** What to do with the local store, given what it recorded and what the server announced. */
export function judgeLineage(stored: string | null, served: string): LineageVerdict {
    if (stored === null) return 'adopt';
    return stored === served ? 'keep' : 'discard';
}

/** The generation after the type byte of a generation or restore frame, or null when the frame has no body or a malformed one. */
export function readFrameGeneration(decoder: decoding.Decoder): string | null {
    if (!decoding.hasContent(decoder)) return null;
    try {
        const gen = decoding.readVarString(decoder);
        return /^[A-Za-z0-9_-]{8,64}$/.test(gen) ? gen : null;
    } catch {
        return null;
    }
}

/** True when the document holds any finding: an empty store has nothing worth a backup. */
export function holdsResults(doc: Y.Doc): boolean {
    return doc.getMap('results').size > 0;
}

/**
 * Save the full state of a store about to be discarded into the one backup slot. Returns the state vector of what was saved;
 * rejects when the slot cannot be written (the caller then abandons the discard). An empty store is not backed up (null).
 */
export async function backUpStale(lineage: ResultsDocLineageStore, doc: Y.Doc, info: DiscardedStoreInfo): Promise<Uint8Array | null> {
    if (!holdsResults(doc)) return null;
    const vector = Y.encodeStateVector(doc);
    await lineage.saveDiscarded(Y.encodeStateAsUpdate(doc), info);
    return vector;
}

/**
 * Edits can land in the stale doc while the store is being torn down (the editor is still typing into it). If the doc moved
 * past what was backed up, back it up again (best-effort, overwriting the slot). Residual: an edit applied during this last
 * write is not in the backup.
 */
export async function topUpBackup(lineage: ResultsDocLineageStore, doc: Y.Doc, info: DiscardedStoreInfo, savedVector: Uint8Array | null): Promise<void> {
    if (savedVector === null) return;
    const now = Y.encodeStateVector(doc);
    if (now.length === savedVector.length && now.every((b, i) => b === savedVector[i])) return;
    await lineage.saveDiscarded(Y.encodeStateAsUpdate(doc), info).catch(() => { /* the first backup stands */ });
}
