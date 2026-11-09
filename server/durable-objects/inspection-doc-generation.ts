/**
 * The lineage ("generation") of a results document.
 *
 * A Yjs document is a history. Two histories of the same inspection that were built independently (a version restore, a
 * document rebuilt from the database, a copy between Durable Object namespaces that replaced a database-built target) share no
 * ancestry, and merging one into the other does not combine them: for every finding the whole item of ONE history wins, chosen
 * by client id, so a browser that kept the old history in its offline store can resurrect deleted photos and drop newer ones.
 *
 * So the object keeps a random id, the generation, that names the history it holds. It is sent to every client as the FIRST
 * frame of a socket (before the sync handshake), and a client whose stored generation differs discards its local copy instead
 * of handing it back. The generation is created with the history, minted again whenever the history is rebuilt, kept through
 * hibernation, and travels WITH the document bytes when the document is copied.
 *
 * Wire format: `MSG_GENERATION` (4) followed by the generation as a varstring. The restore frame carries the same varstring
 * after its type byte (older clients read only the type byte and ignore the rest). The literals are duplicated client-side in
 * `packages/field-ui/src/collab/results-doc-lineage.ts` (there is no shared package; keep the two in sync).
 */

import * as encoding from 'lib0/encoding';

/** Framing byte of the generation frame (0 sync, 2 restore, 3 ack are taken). */
export const MSG_GENERATION = 4;

/** DO storage key holding the generation string. */
export const GEN_KEY = 'gen';

const GENERATION_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/** A new, unguessable lineage id. */
export function newGeneration(): string {
    return crypto.randomUUID();
}

/** True for a generation of the shape this module writes (bounded length, safe characters): the only kind accepted from outside. */
export function isGeneration(value: string | null | undefined): value is string {
    return typeof value === 'string' && GENERATION_PATTERN.test(value);
}

/** The stored generation when it is a valid one, otherwise null. */
export function storedGeneration(value: string | null | undefined): string | null {
    return isGeneration(value) ? value : null;
}

/** `type` then (optionally) the generation as a varstring: the body of the generation frame and of the restore frame. */
export function generationFrame(type: number, gen: string | null): Uint8Array {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, type);
    if (gen !== null) encoding.writeVarString(encoder, gen);
    return encoding.toUint8Array(encoder);
}
