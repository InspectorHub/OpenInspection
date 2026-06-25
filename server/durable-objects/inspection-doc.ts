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
 *   byte 0 = 2 → restore (a bare control frame, no body): the authoritative doc
 *                was replaced by a version restore. The DO only SENDS this; it
 *                tells every connected client to drop its local state and resync
 *                from scratch (Yjs updates are additive/union, so a plain update
 *                broadcast cannot revert deletions on a live client — see #181
 *                Task 12b). Unknown inbound framing bytes are silently dropped.
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
    removeFindingKeys,
} from '../lib/collab/results-doc';
import type { ResultsProjection } from '../lib/collab/results-doc.types';
import { findingKeysFromTemplateSnapshot } from '../lib/finding-key';
import { inspectionResults, inspections } from '../lib/db/schema';
import { logger } from '../lib/logger';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Framing byte for y-protocols sync messages. */
const MSG_SYNC = 0;

/**
 * Framing byte for the restore control frame (a bare signal, no body). The DO
 * broadcasts this after a version restore so live clients drop their local
 * state and resync from scratch. The literal `2` is duplicated client-side in
 * `app/lib/collab/results-doc-connection.ts` (MSG_RESTORE) — there is no shared
 * package; keep the two in sync (mirrors the duplicated MSG_SYNC = 0 pattern).
 */
const MSG_RESTORE = 2;

/** Debounce window before flushing the Y.Doc to DO storage (ms). */
const PERSIST_DEBOUNCE_MS = 1_000;

/** DO storage key for the serialised Y.Doc state vector. */
const STORAGE_KEY = 'ydoc';

/** DO storage key for the persisted tenant/inspection identity. */
const IDENTITY_KEY = 'identity';

/** DO storage key for the JSON array of projection snapshots (version history). */
const SNAPSHOTS_KEY = 'snapshots';

/** Maximum snapshots retained; oldest are dropped when the cap is exceeded. */
const SNAPSHOT_CAP = 25;

/** Auto-snapshot cadence: capture once every N real (non-restore) doc updates. */
const SNAPSHOT_EVERY = 20;

/**
 * Transaction origin sentinel used when restore rebuilds the doc.
 * `onDocUpdate` checks identity against this object to SKIP auto-snapshot
 * counting, so a restore (which itself loads a whole projection) never triggers
 * a snapshot storm.
 *
 * Since Task 12b the restore broadcast is a separate control frame
 * (broadcastRestore / MSG_RESTORE), so this sentinel is no longer passed to
 * broadcastDocUpdate. It is kept as defensive coverage: should any future
 * doc-internal emit fire during a doc swap, onDocUpdate still skips counting it.
 */
const RESTORE_ORIGIN: unique symbol = Symbol('collab-restore-origin');

/**
 * One persisted projection snapshot — a point-in-time copy of the doc projected
 * to the `inspection_results.data` JSON shape. Snapshots are doc-replacement
 * restore points (Condition B): restore rebuilds a fresh Y.Doc from `projection`
 * rather than replaying CRDT updates.
 */
interface ResultsSnapshot {
    seq:        number;
    atMs:       number;
    byUserId:   string | null;
    /**
     * Why the snapshot was taken (see #181 PR-H):
     *   'periodic' — the auto every-SNAPSHOT_EVERY capture in onDocUpdate.
     *   'manual'   — an on-demand POST capture or restore's pre-restore capture.
     *   'connect'  — the pre-merge boundary capture taken when a client reconnects,
     *                BEFORE its buffered offline edits merge (preserves the
     *                about-to-be-overwritten value for the H2 compare/recover UI).
     * Optional so legacy snapshots persisted before this field stay readable.
     */
    reason?:    SnapshotReason;
    projection: ResultsProjection;
}

/** Discriminator for why a snapshot was captured. */
type SnapshotReason = 'periodic' | 'manual' | 'connect';

/** Snapshot metadata (the list view omits the heavy `projection` payload). */
type ResultsSnapshotMeta = Omit<ResultsSnapshot, 'projection'>;

/**
 * Narrow an `unknown` value loaded from DO storage to a snapshot array. DO
 * storage round-trips structured-clone, so the shape is trusted, but a defensive
 * guard keeps the no-`any` rule and tolerates a missing/legacy key.
 */
function asSnapshotArray(value: unknown): ResultsSnapshot[] {
    return Array.isArray(value) ? (value as ResultsSnapshot[]) : [];
}

/**
 * Match a `…/snapshots/<seq>` path and parse the trailing `seq` as a
 * non-negative integer. Returns the parsed seq, or `null` when the path is not
 * a snapshot-by-seq request or the trailing segment is not a valid non-negative
 * integer (so the caller falls through to the generic 404). Trailing slashes are
 * ignored. The `/snapshots` (list/capture) path has no trailing segment and
 * therefore never matches here.
 */
function matchSnapshotBySeqPath(pathname: string): number | null {
    const segments = pathname.replace(/\/+$/, '').split('/');
    const last = segments[segments.length - 1];
    const parent = segments[segments.length - 2];
    if (parent !== 'snapshots') return null;
    // Strict non-negative integer (no signs, decimals, or whitespace).
    if (!/^\d+$/.test(last)) return null;
    const seq = Number(last);
    return Number.isSafeInteger(seq) ? seq : null;
}

/**
 * Stable deep-equality for two result projections. `projectResults` emits a
 * plain, JSON-serialisable object with a deterministic key/element order (Yjs
 * iteration order is insertion order, which is stable across reads of the same
 * doc), so a `JSON.stringify` compare is both correct and cheap here. Used by
 * the connect-time dedup to skip a no-op snapshot when nothing changed since the
 * last capture.
 */
function projectionsEqual(a: ResultsProjection, b: ResultsProjection): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

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
    /**
     * The live authoritative Y.Doc. NOT `readonly` — restore swaps in a fresh
     * doc (doc-replacement, Condition B). The update listener is the stable
     * bound method `onDocUpdate`, re-attached to the new doc after each swap.
     */
    private doc: Y.Doc;
    private persistTimer: ReturnType<typeof setTimeout> | null = null;
    /**
     * Count of real (non-restore) doc updates since the last auto-snapshot.
     * When it reaches SNAPSHOT_EVERY, a snapshot is captured and it resets to 0.
     */
    private updatesSinceSnapshot = 0;
    /**
     * In-flight guard so concurrent triggers (auto + on-demand + restore's
     * pre-capture) never double-write the snapshot array.
     */
    private capturing = false;
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
        // and schedule a debounced persist. The handler is a STABLE bound method
        // (class field arrow) so restore can `.off`/`.on` the IDENTICAL reference
        // when it swaps in a fresh doc.
        this.doc.on('update', this.onDocUpdate);
    }

    /**
     * Stable doc-update handler — wired in the constructor and re-wired by
     * restore (doc-replacement) onto the fresh doc. Behaviour preserved from the
     * original inline ctor closure (broadcast + debounced persist), plus the
     * auto-snapshot cadence.
     *
     * Auto-snapshot: every SNAPSHOT_EVERY real updates, capture a snapshot.
     * Updates whose origin is RESTORE_ORIGIN are NOT counted — restore loads a
     * whole projection in one transaction and pre-captures its own snapshot, so
     * counting it would cause a snapshot storm.
     */
    private onDocUpdate = (update: Uint8Array, origin: unknown): void => {
        this.broadcastDocUpdate(update, origin);
        this.schedulePersist();

        if (origin === RESTORE_ORIGIN) return; // restore-driven — do not count

        this.updatesSinceSnapshot += 1;
        if (this.updatesSinceSnapshot >= SNAPSHOT_EVERY) {
            this.updatesSinceSnapshot = 0;
            void this.captureSnapshot(null, 'periodic');
        }
    };

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

            // PR-H pre-merge boundary snapshot (#181): capture the CURRENT doc
            // state attributed to the connecting user BEFORE accepting the socket
            // and BEFORE this client's buffered offline edits arrive (those come
            // later via webSocketMessage step2). This preserves the state — and
            // any about-to-be-overwritten scalar value — so the H2 compare/recover
            // UI can surface a value LWW would otherwise silently drop.
            //
            // FAIL-OPEN: a snapshot problem must NEVER break collab connect, so the
            // capture is wrapped in try/catch and only logged. The dedup inside
            // captureSnapshotOnConnect skips no-op captures on plain online
            // reconnects (nothing changed since the last snapshot).
            await this.captureSnapshotOnConnect(req.headers.get('x-user-id'));

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

        // ── Snapshot version-history routes ──────────────────────────────────
        // These arrive from the authorized route (server/api/inspections/collab.ts),
        // which has already done the 5-check fail-closed auth and forwards
        // x-tenant-id / x-inspection-id / x-user-id. The DO trusts the route as
        // the sole trust boundary (same as the /ws path).
        if (url.pathname.endsWith('/snapshots')) {
            if (req.method === 'GET') {
                return Response.json(await this.listSnapshots());
            }
            if (req.method === 'POST') {
                const snap = await this.captureSnapshot(req.headers.get('x-user-id'), 'manual');
                return Response.json({ seq: snap.seq, atMs: snap.atMs });
            }
            return new Response('method not allowed', { status: 405 });
        }

        // ── GET …/snapshots/<seq> — one snapshot's FULL record (incl projection).
        // The H2 compare/recover UI diffs two snapshots → it needs each one's
        // full projection (the list view omits it). The seq is the last path
        // segment; it is validated as a non-negative integer (the authorized
        // route also validates, but the DO re-guards as the persistence boundary).
        const snapshotBySeq = matchSnapshotBySeqPath(url.pathname);
        if (snapshotBySeq !== null && req.method === 'GET') {
            const snap = await this.getSnapshot(snapshotBySeq);
            return snap
                ? Response.json(snap)
                : new Response('snapshot not found', { status: 404 });
        }

        if (url.pathname.endsWith('/restore') && req.method === 'POST') {
            let seq: unknown;
            try {
                const body = (await req.json()) as { seq?: unknown };
                seq = body.seq;
            } catch {
                return new Response('invalid body', { status: 400 });
            }
            if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0) {
                return new Response('invalid seq', { status: 400 });
            }
            const out = await this.restoreSnapshot(seq, req.headers.get('x-user-id'));
            return out.ok
                ? Response.json({ ok: true })
                : new Response('snapshot not found', { status: 404 });
        }

        // D8: re-read the already-updated templateSnapshot from D1, diff the
        // current results keys, seed additions and remove deletions, then persist
        // + broadcast so all clients resync. The authorized route forwards the same
        // identity headers as /restore; identity is set below from request headers.
        if (url.pathname.endsWith('/restructure') && req.method === 'POST') {
            // Capture identity from headers forwarded by the authorized route,
            // mirroring the /ws path identity acquisition (the DO trusts the route).
            const headerTenantId     = req.headers.get('x-tenant-id');
            const headerInspectionId = req.headers.get('x-inspection-id');
            if (headerTenantId)     this.tenantId     = headerTenantId;
            if (headerInspectionId) this.inspectionId = headerInspectionId;

            await this.restructure();
            return Response.json({ ok: true });
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

    // ── Snapshot version history (#181 Phase 4) ───────────────────────────────

    /**
     * Capture a projection snapshot of the CURRENT doc and append it to the
     * persisted snapshot array (capped to the last SNAPSHOT_CAP, oldest dropped).
     *
     * `seq` is derived from the stored max + 1 on every call, so it survives
     * hibernation (never held only in memory). `Date.now()` is allowed in the DO
     * runtime (this is not a Workflow script). The in-flight guard prevents two
     * concurrent triggers from racing the read-modify-write of the array.
     */
    private async captureSnapshot(
        byUserId: string | null,
        reason: SnapshotReason = 'manual',
    ): Promise<ResultsSnapshot> {
        // The DO runs single-threaded; this guard serializes the read-modify-write
        // of the snapshot array across INTERLEAVED awaits (an auto-capture firing
        // while an on-demand capture is parked on storage I/O), not OS threads.
        while (this.capturing) {
            await new Promise<void>((resolve) => setTimeout(resolve, 5));
        }
        this.capturing = true;
        try {
            const stored = await this.ctx.storage.get(SNAPSHOTS_KEY);
            const snapshots = asSnapshotArray(stored);

            const maxSeq = snapshots.reduce((m, s) => (s.seq > m ? s.seq : m), -1);
            const snap: ResultsSnapshot = {
                seq:        maxSeq + 1,
                atMs:       Date.now(),
                byUserId,
                reason,
                projection: projectResults(this.doc),
            };

            snapshots.push(snap);
            // Cap to the last SNAPSHOT_CAP entries (drop oldest).
            const capped = snapshots.slice(-SNAPSHOT_CAP);
            await this.ctx.storage.put(SNAPSHOTS_KEY, capped);
            return snap;
        } finally {
            this.capturing = false;
        }
    }

    /**
     * PR-H connect-time capture (#181): take a 'connect' snapshot of the CURRENT
     * doc state, UNLESS it would be a no-op — i.e. the current projection deep-
     * equals the most recent stored snapshot's projection. The dedup avoids a
     * snapshot on every plain online reconnect when nothing has changed since the
     * last snapshot, while still capturing the pre-merge boundary whenever a
     * reconnecting client is about to merge buffered offline edits on top of a
     * state that has moved since the last snapshot.
     *
     * FAIL-OPEN: any failure here is logged and swallowed — a snapshot problem
     * must never break the collab connect (the caller proceeds to accept the WS).
     */
    private async captureSnapshotOnConnect(byUserId: string | null): Promise<void> {
        try {
            const stored = await this.ctx.storage.get(SNAPSHOTS_KEY);
            const snapshots = asSnapshotArray(stored);

            // Dedup against the most-recently-stored snapshot (snapshots are
            // appended in seq order, so the last element is the newest).
            const latest = snapshots[snapshots.length - 1];
            const current = projectResults(this.doc);
            if (latest && projectionsEqual(latest.projection, current)) {
                return; // no change since the last snapshot — skip the no-op
            }

            await this.captureSnapshot(byUserId, 'connect');
        } catch (err) {
            logger.error(
                'collab: connect-time snapshot failed (fail-open)',
                { tenantId: this.tenantId, inspectionId: this.inspectionId },
                err instanceof Error ? err : undefined,
            );
        }
    }

    /**
     * List snapshot metadata (no `projection` payload), newest-first.
     */
    private async listSnapshots(): Promise<ResultsSnapshotMeta[]> {
        const stored = await this.ctx.storage.get(SNAPSHOTS_KEY);
        const snapshots = asSnapshotArray(stored);
        return snapshots
            .map(({ seq, atMs, byUserId, reason }): ResultsSnapshotMeta =>
                // Spread `reason` only when present so the result conforms to
                // `exactOptionalPropertyTypes` (no explicit `undefined` on the
                // optional key) — legacy snapshots have no `reason`.
                reason === undefined
                    ? { seq, atMs, byUserId }
                    : { seq, atMs, byUserId, reason },
            )
            .sort((a, b) => b.seq - a.seq);
    }

    /**
     * Fetch ONE snapshot's full record (including the heavy `projection`) by seq,
     * or `null` when no snapshot with that seq is retained. The H2 compare/recover
     * UI uses this to diff two snapshots' projections.
     */
    private async getSnapshot(seq: number): Promise<ResultsSnapshot | null> {
        const stored = await this.ctx.storage.get(SNAPSHOTS_KEY);
        const snapshots = asSnapshotArray(stored);
        return snapshots.find((s) => s.seq === seq) ?? null;
    }

    /**
     * Doc-replacement restore (Condition B): rebuild a FRESH Y.Doc from the
     * snapshot's projection — NOT `Y.applyUpdate` of an old binary state.
     *
     * Steps:
     *   1. Load the array; find the snapshot with `seq` (absent → { ok: false }).
     *   2. Capture a snapshot of the CURRENT state first so the restore is itself
     *      reversible.
     *   3. Build a fresh Y.Doc and load the target projection into it.
     *   4. Detach the listener from the old doc, swap `this.doc`, re-attach the
     *      IDENTICAL bound handler (so `.off`/`.on` line up).
     *   5. Broadcast a MSG_RESTORE control frame to every connected socket so
     *      each client drops its local state and resyncs from scratch (a plain
     *      additive update broadcast cannot revert deletions on a live client).
     *   6. Persist the restored projection to D1.
     */
    private async restoreSnapshot(
        seq: number,
        byUserId: string | null,
    ): Promise<{ ok: boolean }> {
        const stored = await this.ctx.storage.get(SNAPSHOTS_KEY);
        const snapshots = asSnapshotArray(stored);
        const target = snapshots.find((s) => s.seq === seq);
        if (!target) return { ok: false };

        // (2) Capture current state first — makes the restore reversible.
        await this.captureSnapshot(byUserId, 'manual');

        // (3) Build a fresh doc from the target projection (doc-replacement).
        const fresh = new Y.Doc();
        loadResultsProjection(fresh, target.projection);

        // (4) Swap the doc, re-wiring the SAME bound update handler.
        this.doc.off('update', this.onDocUpdate);
        this.doc = fresh;
        this.doc.on('update', this.onDocUpdate);
        // Re-baseline the auto-snapshot cadence to the restored state so the next
        // periodic capture is measured from here (not the pre-restore counter).
        this.updatesSinceSnapshot = 0;

        // (5) Tell every connected client to drop its local state and resync.
        // A plain additive update broadcast (Yjs union semantics) cannot revert
        // deletions on a client that already holds the post-restore edits, so a
        // dedicated MSG_RESTORE control frame drives true convergence: the client
        // clears its IndexedDB + Y.Doc and re-pulls the authoritative state.
        this.broadcastRestore();

        // (6) Persist the restored projection to D1 + DO storage.
        await this.persist();

        return { ok: true };
    }

    // ── D8: Template restructure ──────────────────────────────────────────────

    /**
     * Re-read the (already-updated) `templateSnapshot` from D1, diff the current
     * results keys, seed new findingKeys and remove deleted ones, then persist
     * + broadcastRestore() so every connected client drops its local state and
     * resyncs from scratch.
     *
     * Called by the authorized `POST /:id/collab/restructure` route after the
     * templateSnapshot PATCH has already landed in D1. The DO is the sole writer
     * of `inspection_results.data`; this is the convergence seam.
     *
     * Tenant scoping: the D1 read includes eq(inspections.tenantId, …) — keeps
     * the lint:tenant-scope baseline green.
     */
    async restructure(): Promise<void> {
        const { tenantId, inspectionId } = this;
        if (!tenantId || !inspectionId) return; // identity unknown — nothing to do

        const db: DrizzleD1Database = drizzle(this.env.DB);

        const inspectionRow = await db
            .select({ templateSnapshot: inspections.templateSnapshot })
            .from(inspections)
            .where(
                and(
                    eq(inspections.tenantId, tenantId),
                    eq(inspections.id,       inspectionId),
                ),
            )
            .get();

        const newKeys = findingKeysFromTemplateSnapshot(
            inspectionRow?.templateSnapshot ?? null,
        );
        const newSet = new Set(newKeys);

        const results = this.doc.getMap<unknown>('results');
        const current = [...results.keys()];

        const toAdd    = newKeys
            .filter((k) => !results.has(k))
            .map((findingKey) => ({ findingKey }));
        const toRemove = current.filter((k) => !newSet.has(k));

        seedResultsDoc(this.doc, toAdd);
        removeFindingKeys(this.doc, toRemove);

        await this.persist();
        this.broadcastRestore();
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

    /**
     * Broadcast a bare MSG_RESTORE control frame (one varint byte, no body) to
     * EVERY connected socket — no origin skip, because every client (including
     * whoever triggered the restore) must drop its local state and resync. The
     * client handles this by clearing its IndexedDB + Y.Doc and re-pulling the
     * authoritative restored state via a fresh sync step1 (#181 Task 12b).
     */
    private broadcastRestore(): void {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MSG_RESTORE);
        const msg = encoding.toUint8Array(encoder);
        for (const sock of this.ctx.getWebSockets()) {
            try { sock.send(msg); } catch { /* already closed */ }
        }
    }
}
