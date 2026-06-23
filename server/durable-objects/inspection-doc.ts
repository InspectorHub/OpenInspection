/**
 * InspectionDocDO — One Durable Object instance per inspection.
 *
 * Holds the authoritative Y.Doc for collaborative results editing.
 * Uses the WebSocket Hibernation API (ctx.acceptWebSocket) so idle DOs
 * do not bill. The DO is data-only: awareness/presence stays in
 * InspectionPresenceDO.
 *
 * POC fixes applied (see poc/181-yjs-collab:workers/poc-collab-do.ts):
 *   1. Hydration in the constructor via ctx.blockConcurrencyWhile() — a
 *      hibernation-reconstructed DO is never empty when the first
 *      webSocketMessage fires (POC only hydrated in fetch(), too late).
 *   2. Awareness entirely dropped — byte0=1 path removed; this DO is
 *      data-only (presence lives in InspectionPresenceDO).
 *   3. Task-5 seam — persist() is a named method so Task 5 can extend it
 *      to also write the projected results to D1 (without touching the DO
 *      sync or hydration logic).
 *
 * WebSocket message framing:
 *   byte 0 = 0 → sync (y-protocols/sync message: step1 / step2 / update)
 *   (byte 0 = 1 was awareness — dropped in this production DO)
 *
 * Identity: tenantId + inspectionId are passed in request headers by the
 * authorized route (Task 5). The DO reads them for logging only and never
 * trusts the WebSocket client for auth.
 */

import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import type { AppEnv } from '../types/hono';
import { projectResults } from '../lib/collab/results-doc';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Framing byte for y-protocols sync messages. */
const MSG_SYNC = 0;

/** Debounce window before flushing the Y.Doc to DO storage (ms). */
const PERSIST_DEBOUNCE_MS = 1_000;

/** DO storage key for the serialised Y.Doc state vector. */
const STORAGE_KEY = 'ydoc';

// ─── InspectionDocDO ─────────────────────────────────────────────────────────

export class InspectionDocDO extends DurableObject<AppEnv> {
    private readonly doc: Y.Doc;
    private persistTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(ctx: DurableObjectState, env: AppEnv) {
        super(ctx, env);

        this.doc = new Y.Doc();

        // POC fix #1: hydrate before any webSocketMessage can arrive.
        // blockConcurrencyWhile suspends all incoming requests until the
        // Promise resolves, guaranteeing that a hibernation-reconstructed DO
        // always has the persisted state loaded before the first message.
        ctx.blockConcurrencyWhile(() => this.hydrate());

        // Relay doc updates to all connected sockets (except the originator)
        // and schedule a debounced persist.
        this.doc.on('update', (update: Uint8Array, origin: unknown) => {
            this.broadcastDocUpdate(update, origin);
            this.schedulePersist();
        });
    }

    // ── fetch ─────────────────────────────────────────────────────────────────

    async fetch(req: Request): Promise<Response> {
        const url = new URL(req.url);

        if (url.pathname.endsWith('/ws')) {
            if (req.headers.get('Upgrade') !== 'websocket') {
                return new Response('expected websocket upgrade', { status: 426 });
            }

            // Identity is forwarded by the authorized route (Task 5) — read
            // for observability only; the DO never uses these for access control.
            const _tenantId     = req.headers.get('x-tenant-id');
            const _inspectionId = req.headers.get('x-inspection-id');
            void _tenantId; void _inspectionId; // consumed by Task 5 once D1 seam is wired

            const pair   = new WebSocketPair();
            const client = pair[0];
            const server = pair[1];

            // Hibernation API — the DO can sleep between messages.
            this.ctx.acceptWebSocket(server);

            // Send sync step 1 (our current state vector) to the new client.
            const syncEncoder = encoding.createEncoder();
            encoding.writeVarUint(syncEncoder, MSG_SYNC);
            syncProtocol.writeSyncStep1(syncEncoder, this.doc);
            server.send(encoding.toUint8Array(syncEncoder));

            return new Response(null, { status: 101, webSocket: client });
        }

        return new Response('not found', { status: 404 });
    }

    // ── WebSocket hibernation handlers ────────────────────────────────────────

    async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
        // Only binary frames carry y-protocols messages.
        if (typeof raw === 'string') return;

        const data = raw instanceof ArrayBuffer ? new Uint8Array(raw) : raw;
        if (data.length === 0) return;

        const decoder = decoding.createDecoder(data);
        const msgType = decoding.readVarUint(decoder);

        if (msgType === MSG_SYNC) {
            // Build a reply encoder; readSyncMessage writes a step2 reply when
            // the incoming message is a step1. For step2 / update messages it
            // returns the type but writes nothing — we skip the send.
            const replyEncoder = encoding.createEncoder();
            encoding.writeVarUint(replyEncoder, MSG_SYNC);
            const syncMsgType = syncProtocol.readSyncMessage(
                decoder,
                replyEncoder,
                this.doc,
                ws, // origin — passed to the doc.on('update') listener
            );
            if (syncMsgType === syncProtocol.messageYjsSyncStep1) {
                ws.send(encoding.toUint8Array(replyEncoder));
            }
            return;
        }
        // Unknown framing byte — silently drop (no awareness path in this DO).
    }

    async webSocketClose(ws: WebSocket): Promise<void> {
        try { ws.close(); } catch { /* already closed */ }
    }

    async webSocketError(ws: WebSocket): Promise<void> {
        try { ws.close(1011, 'error'); } catch { /* already closed */ }
    }

    // ── Persistence seam (Task 5 extends this) ────────────────────────────────

    /**
     * Persist the current Y.Doc state to DO storage.
     *
     * Task-5 seam: Task 5 will extend this method to also call projectResults()
     * and write the projection to D1. That extension must NOT touch the sync or
     * hydration logic above — only add D1 writes after the existing storage.put.
     */
    protected async persist(): Promise<void> {
        await this.ctx.storage.put(STORAGE_KEY, Y.encodeStateAsUpdate(this.doc));

        // ── Task-5 D1 seam ────────────────────────────────────────────────────
        // Compute the JSON projection so it is available for Task 5 to persist
        // to D1 (inspection_results.data). Task 5 will override / extend this
        // method with the actual D1 write using the projection below.
        //
        // Left here as a clearly-marked extension point; Task 5 reads tenantId
        // + inspectionId from stored headers (forwarded via request) and calls:
        //
        //   const projection = projectResults(this.doc);
        //   await db.update(inspectionResults).set({ data: projection })
        //       .where(and(eq(...tenantId), eq(...inspectionId)));
        //
        // Import kept alive to confirm no dead-code removal by the bundler.
        void projectResults; // consumed by Task 5
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    /** Load the persisted Y.Doc binary from DO storage into the in-memory doc. */
    private async hydrate(): Promise<void> {
        const stored = await this.ctx.storage.get<Uint8Array>(STORAGE_KEY);
        if (stored instanceof Uint8Array && stored.length > 0) {
            Y.applyUpdate(this.doc, stored);
        }
    }

    /**
     * Debounced persist: cancel any pending timer and schedule a new one.
     * Fires ~1 s after the last doc update in a burst.
     */
    private schedulePersist(): void {
        if (this.persistTimer !== null) clearTimeout(this.persistTimer);
        this.persistTimer = setTimeout(() => {
            this.persistTimer = null;
            void this.persist();
        }, PERSIST_DEBOUNCE_MS);
    }

    /**
     * Broadcast a doc update to all connected sockets except the originator.
     * The origin is the WebSocket that sent the update (passed as the
     * `transactionOrigin` to Y.Doc by readSyncMessage).
     */
    private broadcastDocUpdate(update: Uint8Array, origin: unknown): void {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MSG_SYNC);
        syncProtocol.writeUpdate(encoder, update);
        const msg = encoding.toUint8Array(encoder);
        for (const sock of this.ctx.getWebSockets()) {
            if (sock === origin) continue; // do not echo back to sender
            try { sock.send(msg); } catch { /* already closed */ }
        }
    }
}
