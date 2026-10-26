/**
 * Collab ack frame: after the Durable Object has written the document to its own
 * storage, every socket that opted in (`?ack=1` on the upgrade, forwarded by the
 * route as `x-collab-ack: 1` and kept as a hibernation tag) receives
 * `[MSG_ACK, varUint8Array(Y.encodeSnapshot(Y.snapshot(doc)))]`.
 *
 * The snapshot is a state vector plus a delete set, so a client can ask
 * `Y.snapshotContainsUpdate(snapshot, update)` for an edit that only deleted
 * something, which a state vector alone cannot answer. It states what the
 * Durable Object's storage holds; it says nothing about delivery to other
 * clients or about the D1 projection.
 */

import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import { logger } from '../lib/logger';

/** Hibernation tag carried by every socket that opted in; survives hibernation. */
export const ACK_TAG = 'ack';

/** Largest ack frame sent; a bigger one is skipped and the client falls back to the handshake proof. */
const ACK_MAX_BYTES = 65_536;

/** The upgrade headers the route forwarded: the tags to accept the socket with. */
export function ackTags(req: Request): string[] {
    return req.headers.get('x-collab-ack') === '1' ? [ACK_TAG] : [];
}

/** A persist that failed in a timer or an alarm has no caller to throw to. */
export function logPersistFailure(err: unknown): void {
    logger.error('Results document persist failed', {}, err instanceof Error ? err : new Error(String(err)));
}

/** The ack frame for the document as it is now, or null when it exceeds ACK_MAX_BYTES. */
function buildAckFrame(doc: Y.Doc, msgAck: number): Uint8Array | null {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, msgAck);
    encoding.writeVarUint8Array(enc, Y.encodeSnapshot(Y.snapshot(doc)));
    const frame = encoding.toUint8Array(enc);
    return frame.length <= ACK_MAX_BYTES ? frame : null;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
    return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Remembers what was last acked so an unchanged document is not acked again. */
export class AckTracker {
    private lastFrame: Uint8Array | null = null;
    private warned = false;

    constructor(private readonly msgAck: number) {}

    /**
     * Take the snapshot NOW (call in the same synchronous run as the state update
     * is encoded, before awaiting the storage write) and return the function that
     * sends it once the write has succeeded. Null when nothing should be sent.
     */
    prepare(doc: Y.Doc, targets: WebSocket[]): (() => void) | null {
        if (targets.length === 0) return null;
        const frame = buildAckFrame(doc, this.msgAck);
        if (!frame) {
            if (!this.warned) logger.warn('Collab ack skipped: snapshot exceeds the size cap', { clientIds: doc.store.clients.size });
            this.warned = true;
            return null;
        }
        if (this.lastFrame && sameBytes(frame, this.lastFrame)) return null;
        return () => {
            this.lastFrame = frame;
            for (const sock of targets) {
                try { sock.send(frame); } catch { /* already closed */ }
            }
        };
    }
}
