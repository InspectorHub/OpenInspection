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
 * The server also CHECKS what the client reports. A client that holds a recorded generation names it on the upgrade (`?gen=<id>`;
 * the route forwards it as `x-collab-gen`). Three cases, decided at the upgrade, after the document is loaded and before anything
 * is sent or accepted:
 *  - the same id, or no `gen` parameter at all: the socket is served as always (handshake, then writes).
 *  - any other value, including a malformed one: the client holds a history this object no longer has. The socket receives
 *    the generation frame ONLY (no step 1, so nothing invites a reply), is tagged `stale-lineage` and closed with code 4410. A
 *    client that follows the protocol judges that frame as a mismatch, backs up and discards its store (the same path as any
 *    discard: the existing generation frame is the reset instruction, no second mechanism), records the new id and reconnects
 *    with it. Frames that still arrive on a tagged socket are dropped, so such a socket can never write. Closing is what
 *    lifts the hold: a hold cannot be cleared on an open socket, so the next upgrade, carrying the new id, is the acknowledgement.
 *    A client that ignores the frame reconnects with the same stale id and is refused again (the usual backoff applies).
 *  - Tabs: a connection reports the generation its IN-MEMORY document belongs to, not what a sibling tab last wrote to the
 *    shared record, so a tab still holding the old history is refused even after another tab recorded the new id.
 * What this cannot do: a client that sends no `gen` (a build that predates this parameter, including every build that predates the
 * guard, which also ignores the generation frame, and the native client, which has its own connector) cannot be told apart from a
 * current one that holds nothing recorded, and refusing it would lock out every legitimate old client. It keeps today's behaviour:
 * the generation frame is its only protection, and a bundle that ignores that frame can still merge its old history until
 * its cached bundle is replaced by a reload. That window is the one residual gap of the guard.
 *
 * Wire format: `MSG_GENERATION` (4) followed by the generation as a varstring. The restore frame carries the same varstring
 * after its type byte (older clients read only the type byte and ignore the rest). The literals are duplicated client-side in
 * `packages/field-ui/src/collab/results-doc-lineage.ts` (there is no shared package; keep the two in sync).
 */

import * as encoding from 'lib0/encoding';

/** Framing byte of the generation frame (0 sync, 2 restore, 3 ack are taken). */
export const MSG_GENERATION = 4;

/** Header the route sets from the upgrade's `gen` query parameter (never copied from the client's own headers). */
export const GEN_HEADER = 'x-collab-gen';

/** Hibernation tag of a socket that reported another history; such a socket takes no writes. */
export const STALE_TAG = 'stale-lineage';

/** Close code of a refused socket (4409 is "published"). Not special to the client: it reconnects with the usual backoff. */
export const CLOSE_STALE_LINEAGE = 4410;

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

/** True when the client named a generation and it is not the one this object holds. No claim at all is never stale (see the header). */
export function isStaleClaim(claimed: string | null, current: string): boolean {
    return claimed !== null && claimed !== current;
}

/** True for a socket accepted by `staleLineageResponse`. */
export function isStaleSocket(ctx: DurableObjectState, ws: WebSocket): boolean {
    return ctx.getTags(ws).includes(STALE_TAG);
}

/** The upgrade answer for a client holding another history: the generation frame, then close. See the header comment. */
export function staleLineageResponse(ctx: DurableObjectState, current: string): Response {
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    ctx.acceptWebSocket(server, [STALE_TAG]);
    server.send(generationFrame(MSG_GENERATION, current));
    server.close(CLOSE_STALE_LINEAGE, 'LINEAGE');
    return new Response(null, { status: 101, webSocket: client });
}
