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
import { drizzle } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import type { AppEnv } from '../types/hono';
import {
    projectResults,
    seedResultsDoc,
    loadResultsProjection,
} from '../lib/collab/results-doc';
import type { ResultsProjection } from '../lib/collab/results-doc.types';
import { findingKeysFromTemplateSnapshot } from '../lib/finding-key';
import { inspectionResults, inspections } from '../lib/db/schema';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Framing byte for y-protocols sync messages. */
const MSG_SYNC = 0;

/** Debounce window before flushing the Y.Doc to DO storage (ms). */
const PERSIST_DEBOUNCE_MS = 1_000;

/** DO storage key for the serialised Y.Doc state vector. */
const STORAGE_KEY = 'ydoc';

/** DO storage key for the persisted tenant/inspection identity. */
const IDENTITY_KEY = 'identity';

/** Shape of the persisted identity stored across hibernation. */
interface PersistedIdentity {
    tenantId:     string;
    inspectionId: string;
}

/**
 * Narrow a D1 `inspection_results.data` json value to a non-empty projection.
 * The column is `text({ mode: 'json' })`, so drizzle returns the parsed value
 * as `unknown`. Empty / null / non-object / `{}` blobs are not worth importing
 * (an empty doc projects to `{}`), so the guard rejects them.
 */
function isNonEmptyProjection(value: unknown): value is ResultsProjection {
    return (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        Object.keys(value).length > 0
    );
}

// ─── InspectionDocDO ─────────────────────────────────────────────────────────

export class InspectionDocDO extends DurableObject<AppEnv> {
    private readonly doc: Y.Doc;
    private persistTimer: ReturnType<typeof setTimeout> | null = null;
    /**
     * Forwarded by the authorized route (Task 5); populated on first WS accept
     * and durably persisted to DO storage (I1) so hibernation reconstruction
     * can restore identity without waiting for a new WS connection.
     */
    private tenantId:          string | null = null;
    private inspectionId:      string | null = null;
    /** True once identity has been written to DO storage (avoids redundant puts). */
    private identityPersisted: boolean       = false;
    /**
     * True when this DO already had a persisted Y.Doc binary in DO storage at
     * construction time (set in hydrate()). This is the NO-WIPE guard: when prior
     * collab state exists, the collaborative doc is authoritative and ahead of
     * D1, so the (potentially stale) D1 `inspection_results.data` blob MUST NOT be
     * imported on top of it — doing so would clobber unflushed collab edits. The
     * D1 blob is imported ONLY when this is false (no prior collab state).
     */
    private hadStoredState: boolean = false;
    /**
     * Memoizes the one-time D1 hydration so concurrent first connects await the
     * same load (one D1 read per DO lifetime). Lazily created in hydrateFromD1Once.
     */
    private d1HydrationPromise: Promise<void> | null = null;

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

            // Identity is forwarded by the authorized route — store for D1
            // persistence. The DO never uses these for access control (the
            // authorized route is the trust boundary).
            const headerTenantId     = req.headers.get('x-tenant-id');
            const headerInspectionId = req.headers.get('x-inspection-id');
            if (headerTenantId)     this.tenantId     = headerTenantId;
            if (headerInspectionId) this.inspectionId = headerInspectionId;

            // M3: fail-closed — reject the upgrade if identity is unknown from
            // both headers and stored state (hydrate() would have loaded it).
            if (!this.tenantId || !this.inspectionId) {
                return new Response('missing tenant/inspection identity', { status: 400 });
            }

            // I1: persist identity to DO storage on the first WS accept so a
            // hibernation-reconstructed DO knows its tenant/inspection even
            // before the next client connects (alarm() can then flush to D1).
            if (!this.identityPersisted) {
                await this.ctx.storage.put<PersistedIdentity>(IDENTITY_KEY, {
                    tenantId:     this.tenantId,
                    inspectionId: this.inspectionId,
                });
                this.identityPersisted = true;
            }

            // Hydrate from D1 once per DO lifetime, AFTER identity is known and
            // BEFORE step1 is sent so the step1 state vector reflects the seeded
            // template structure (Condition A) and any imported D1 blob. The
            // memoized promise guarantees a single D1 load; concurrent connects
            // await the same promise.
            await this.hydrateFromD1Once();

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
        await this.flushOnLastDisconnect();
    }

    async webSocketError(ws: WebSocket): Promise<void> {
        try { ws.close(1011, 'error'); } catch { /* already closed */ }
        await this.flushOnLastDisconnect();
    }

    /**
     * I2 — durable alarm backstop: called by the DO runtime when the alarm
     * fires. Persists the Y.Doc if the in-memory setTimeout was lost to
     * hibernation before it could fire.
     */
    async alarm(): Promise<void> {
        await this.persist();
    }

    // ── Persistence seam (Task 5 extends this) ────────────────────────────────

    /**
     * Persist the current Y.Doc state to DO storage AND to D1.
     *
     * DO storage write: always (survives hibernation reconstruction).
     * D1 write: only when tenantId + inspectionId are known (set by the first
     * WS accept after the authorized route forwards the upgrade).
     *
     *   inspection_results.ydoc_state  ← Y.encodeStateAsUpdate(doc) (binary)
     *   inspection_results.data        ← projectResults(doc) (raw object; drizzle mode:'json' serializes once)
     *   inspection_results.lastSyncedAt← now
     *
     * Both columns are updated in a single `.set()` call so readers never
     * see a state where `data` lags behind `ydoc_state`.
     *
     * The WHERE clause scopes by BOTH tenantId AND inspectionId — the
     * tenant-scoping gate (`node scripts/check-tenant-scoping.mjs`) requires
     * every D1 write in this file to include `eq(table.tenantId, ...)`.
     */
    protected async persist(): Promise<void> {
        // ── DO storage ────────────────────────────────────────────────────────
        const stateUpdate = Y.encodeStateAsUpdate(this.doc);
        await this.ctx.storage.put(STORAGE_KEY, stateUpdate);

        // ── D1 projection write ───────────────────────────────────────────────
        const { tenantId, inspectionId } = this;
        if (!tenantId || !inspectionId) {
            // Identity not yet known (DO awakened before first WS connect).
            // Skip D1 write — DO storage is sufficient until a client connects.
            return;
        }

        const db: DrizzleD1Database = drizzle(this.env.DB);
        const projection = projectResults(this.doc);

        await db
            .update(inspectionResults)
            .set({
                ydocState:    stateUpdate,
                data:         projection,
                lastSyncedAt: new Date(),
            })
            .where(
                and(
                    eq(inspectionResults.tenantId,     tenantId),
                    eq(inspectionResults.inspectionId, inspectionId),
                ),
            );
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    /**
     * I1: Load the persisted Y.Doc binary AND the stored tenant/inspection
     * identity from DO storage. Called inside blockConcurrencyWhile() so a
     * hibernation-reconstructed DO is always fully initialised before any
     * webSocketMessage fires or alarm() runs.
     */
    private async hydrate(): Promise<void> {
        const [stored, identity] = await Promise.all([
            this.ctx.storage.get<Uint8Array>(STORAGE_KEY),
            this.ctx.storage.get<PersistedIdentity>(IDENTITY_KEY),
        ]);

        if (stored instanceof Uint8Array && stored.length > 0) {
            Y.applyUpdate(this.doc, stored);
            // NO-WIPE guard: prior collab state existed. The D1 blob must never be
            // imported on top of it (see hadStoredState + doHydrateFromD1).
            this.hadStoredState = true;
        }

        // Restore identity so persist() / alarm() can write D1 without waiting
        // for the next WS connection to deliver the identity headers again.
        if (identity) {
            this.tenantId          = identity.tenantId;
            this.inspectionId      = identity.inspectionId;
            this.identityPersisted = true; // already in storage — skip the put
        }
    }

    /**
     * One-time D1 hydration, memoized: the first caller starts the load; all
     * later/concurrent callers await the same promise. Guarantees exactly one
     * D1 read per DO lifetime regardless of how many clients connect.
     */
    private hydrateFromD1Once(): Promise<void> {
        this.d1HydrationPromise ??= this.doHydrateFromD1();
        return this.d1HydrationPromise;
    }

    /**
     * Seed the full template structure (Condition A) and — only when there is no
     * prior collab state — import the existing D1 `inspection_results.data` blob
     * so collaborative editing starts from current truth.
     *
     * Requires identity (tenantId + inspectionId) to be set — only called from
     * fetch() after identity is established.
     *
     * Tenant scoping: both D1 reads include `eq(table.tenantId, this.tenantId)`
     * (the tenant-scoping invariant for every read in this DO).
     */
    private async doHydrateFromD1(): Promise<void> {
        const { tenantId, inspectionId } = this;
        if (!tenantId || !inspectionId) return; // identity unknown — nothing to load

        const db: DrizzleD1Database = drizzle(this.env.DB);

        // ── Load the template snapshot + the existing results blob (tenant-scoped).
        const [inspectionRow, resultsRow] = await Promise.all([
            db
                .select({ templateSnapshot: inspections.templateSnapshot })
                .from(inspections)
                .where(
                    and(
                        eq(inspections.tenantId, tenantId),
                        eq(inspections.id,       inspectionId),
                    ),
                )
                .get(),
            db
                .select({ data: inspectionResults.data })
                .from(inspectionResults)
                .where(
                    and(
                        eq(inspectionResults.tenantId,     tenantId),
                        eq(inspectionResults.inspectionId, inspectionId),
                    ),
                )
                .get(),
        ]);

        // ── Condition A: ALWAYS seed every template item's findingKey structure
        // (idempotent — seedResultsDoc skips keys that already exist), so two
        // clients can never lazily create the same item Y.Map and race.
        const findingKeys = findingKeysFromTemplateSnapshot(
            inspectionRow?.templateSnapshot ?? null,
        );
        if (findingKeys.length > 0) {
            seedResultsDoc(
                this.doc,
                findingKeys.map((key) => ({ findingKey: key })),
            );
        }

        // ── NO-WIPE import: only when there is NO prior collab state. When prior
        // collab state existed (hadStoredState), the doc is authoritative and
        // ahead of D1 — importing the stale blob would clobber unflushed edits.
        if (!this.hadStoredState) {
            const blob = resultsRow?.data;
            if (isNonEmptyProjection(blob)) {
                loadResultsProjection(this.doc, blob);
            }
        }
    }

    /**
     * I2 debounced persist: cancel any pending timer and schedule a new one.
     * Fires ~1 s after the last doc update in a burst (warm-path fast flush).
     * Also sets a DO storage alarm as a durable backstop: the alarm survives
     * hibernation; the in-memory setTimeout does not.
     */
    private schedulePersist(): void {
        if (this.persistTimer !== null) clearTimeout(this.persistTimer);
        this.persistTimer = setTimeout(() => {
            this.persistTimer = null;
            void this.persist();
        }, PERSIST_DEBOUNCE_MS);

        // Alarm is overwritten (idempotent) on every update burst — it always
        // lands PERSIST_DEBOUNCE_MS from the latest update, matching setTimeout.
        void this.ctx.storage.setAlarm(Date.now() + PERSIST_DEBOUNCE_MS);
    }

    /**
     * I2 final-flush: if this is the last socket to disconnect, cancel any
     * pending debounce timer and persist immediately so the final burst of
     * edits is never lost.
     */
    private async flushOnLastDisconnect(): Promise<void> {
        if (this.ctx.getWebSockets().length > 0) return; // other clients remain
        if (this.persistTimer !== null) {
            clearTimeout(this.persistTimer);
            this.persistTimer = null;
        }
        await this.persist();
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
