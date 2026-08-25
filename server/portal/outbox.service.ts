import { drizzle } from 'drizzle-orm/d1';
import { eq, and, asc, lt, sql, inArray } from 'drizzle-orm';
import { syncOutbox } from '../lib/db/schema';
import { SYNC_OUTBOX_STATUS } from '../lib/status/sync-outbox-status';
import { logger } from '../lib/logger';
import { toCloudEvent } from '../lib/sync-events/envelope';
import type { CmdReplyEventType, SyncEnvelope } from '../lib/sync-events/envelope';
import type { MigrationSyncEvent, TenantSyncEvent, UserSyncEvent, UserSyncOutbox } from '../lib/integration/user-sync';

/**
 * Core -> Portal sync outbox (A-13/A-14, Cloudflare Queues transport).
 *
 * `append()` captures a single user-lifecycle event in the same DB write that
 * produced the underlying mutation. When constructed with a `publish` hook
 * (di.ts wires this when SYNC_QUEUE is present), append fires the hook so the
 * row is pushed to the queue inline via executionCtx.waitUntil — near-zero
 * propagation latency. If the inline publish fails, the row simply stays
 * `pending` and the cron sweeper republishes it within ~2 minutes.
 *
 * State machine (spec §6): pending -> published (terminal happy path; the queue
 * owns delivery from there, portal dedup makes redelivery harmless). `failed`
 * is set ONLY by the DLQ writeback (markFailedFromDlq). Legacy `done` rows are
 * treated as terminal and ignored by the sweeper.
 *
 * Portal dedupes by row id, so retries here are idempotent on the receiver.
 */

// Canonical event shapes live in the seam (lib/integration/user-sync) so core
// services can depend on them without importing this concrete module.
// A-21 batch 2/3: the outbox also carries command REPLIES (emitted by the cmd
// consumer) on the same queue — widened here, NOT in the user-sync seam
// (replies are not user-lifecycle events).
// P3 adds the two DSAR replies (`reply.subject.*`) to the same channel.
//
// ⚠️ NOTHING HERE RESTATES AN EVENT NAME, and that is the point. This union
// used to spell out its own copy of the reply list and its own tenant type, and
// the old comment in this slot asked the next reader to keep it in step with
// `CmdReplyType` in `cmd-reply.ts` by hand — "two lists of one fact", it said,
// having already been bitten once when the correction reply compiled on the
// emitting side and was unassignable here. The prediction was right and the
// remedy was too weak: the tenant member drifted anyway, in a way no amount of
// keeping-in-step would have caught, because it drifted away from a THIRD list
// (the wire registry) that the warning did not mention.
//
// So every member below is now an `Extract<>` off `SyncEventType` in
// lib/sync-events/envelope, which is itself `keyof typeof SCHEMAS`. There is one
// list, it is the one the wire is built from, and an event type absent from it
// cannot be passed to `append()` — that is a compile error, proven by
// tests/unit/sync/outbox-event-type-closed.spec-d.ts.
export type OutboxEvent = UserSyncEvent | TenantSyncEvent | MigrationSyncEvent | {
    type: CmdReplyEventType;
    payload: Record<string, unknown>;
};

export interface OutboxRow {
    id: string;
    eventType: string;
    payload: string;          // JSON-encoded
    status: string;
    attempts: number;
    createdAt: Date;
    lastTriedAt: Date | null;
    lastError: string | null;
}

/** Sweeper publish window: a row must be at least this many seconds old before
 *  the cron sweeper republishes it. Gives the inline waitUntil publish time to
 *  win first, so the sweeper only picks up rows whose inline send failed. */
const SWEEP_MIN_AGE_SECONDS = 120;

export class OutboxService implements UserSyncOutbox {
    /**
     * @param db      D1 binding.
     * @param publish Optional fire-and-forget hook invoked after a successful
     *                append() with the freshly-inserted row. di.ts wires this
     *                to `executionCtx.waitUntil(publishRow(SYNC_QUEUE, row))`
     *                when the queue binding is present. Absent in standalone.
     */
    constructor(
        private db: D1Database,
        private publish?: (row: OutboxRow) => void,
    ) {}

    /**
     * `drizzle(this.db)` — no cast. The `as any` that used to sit here was not
     * working around anything: `drizzle`'s parameter is `AnyD1Database`, which
     * resolves to exactly the global `D1Database` this class already holds
     * (`@miniflare/d1` is not a dependency, so drizzle's optional Miniflare arm
     * collapses to `never`). It compiles unchanged with the cast removed.
     *
     * Its real cost was the suppression comment above it, which disabled
     * `no-explicit-any` for the line and left the file looking like it had a
     * reviewed exception. There are further `drizzle(… as any)` and
     * `drizzle(… as never)` sites under server/api/ that are almost certainly
     * the same non-problem, copied outward from somewhere like here.
     */
    private getDb() {
        return drizzle(this.db);
    }

    /**
     * Append a new pending event. Returns the generated event id (= the dedup
     * key portal sees). After the insert, fires the optional `publish` hook so
     * the row can be pushed to the queue inline (di.ts wraps it in
     * executionCtx.waitUntil). The hook is best-effort: any failure leaves the
     * row `pending` for the sweeper.
     */
    async append(event: OutboxEvent): Promise<string> {
        const id = crypto.randomUUID();
        const now = new Date();
        await this.getDb().insert(syncOutbox).values({
            id,
            eventType: event.type,
            payload: JSON.stringify(event.payload),
            status: SYNC_OUTBOX_STATUS.PENDING,
            attempts: 0,
            createdAt: now,
        });
        if (this.publish) {
            this.publish({
                id,
                eventType: event.type,
                payload: JSON.stringify(event.payload),
                status: SYNC_OUTBOX_STATUS.PENDING,
                attempts: 0,
                createdAt: now,
                lastTriedAt: null,
                lastError: null,
            });
        }
        return id;
    }

    /**
     * Read pending events, oldest first, up to `limit`. When `olderThanSeconds`
     * is set, only rows whose `created_at` is at least that old are returned —
     * the sweeper uses this so it does not race the inline publish.
     */
    async listPending(limit = 50, olderThanSeconds?: number): Promise<OutboxRow[]> {
        const base = this.getDb().select().from(syncOutbox);
        const rows = await (olderThanSeconds !== undefined
            ? base.where(and(
                eq(syncOutbox.status, SYNC_OUTBOX_STATUS.PENDING),
                lt(syncOutbox.createdAt, new Date(Date.now() - olderThanSeconds * 1000)),
            ))
            : base.where(eq(syncOutbox.status, SYNC_OUTBOX_STATUS.PENDING)))
            .orderBy(asc(syncOutbox.createdAt))
            .limit(limit)
            .all();
        return rows as unknown as OutboxRow[];
    }

    /**
     * Publish a single row to the sync queue, then mark it `published`. Throws
     * if the queue send fails (callers — inline waitUntil + sweeper — swallow
     * the error so the row stays `pending` for the next sweep).
     */
    async publishRow(queue: Queue<SyncEnvelope>, row: OutboxRow): Promise<void> {
        const envelope = toCloudEvent({
            id: row.id,
            eventType: row.eventType,
            payload: row.payload,
            createdAt: row.createdAt,
        });
        await queue.send(envelope);
        await this.getDb().update(syncOutbox)
            .set({ status: SYNC_OUTBOX_STATUS.PUBLISHED, lastTriedAt: new Date(), lastError: null })
            .where(eq(syncOutbox.id, row.id));
    }

    /**
     * DLQ writeback: a message exhausted its consumer retries and landed on the
     * dead-letter queue. Mark the originating row `failed` + record the error +
     * bump attempts. This D1 row is the durable failure record (the free-tier
     * 24h DLQ retention is irrelevant). Surfaced by counts() / the console.
     */
    async markFailedFromDlq(id: string, error: string): Promise<void> {
        const now = new Date();
        const row = await this.getDb().select({ attempts: syncOutbox.attempts })
            .from(syncOutbox).where(eq(syncOutbox.id, id)).get();
        const attempts = (row?.attempts ?? 0) + 1;
        await this.getDb().update(syncOutbox)
            .set({ status: SYNC_OUTBOX_STATUS.FAILED, attempts, lastTriedAt: now, lastError: error.slice(0, 1000) })
            .where(eq(syncOutbox.id, id));
    }

    /**
     * Re-drive failed rows back to `pending` so the next sweeper tick
     * republishes them. With no ids, re-drives every `failed` row. Returns the
     * number of rows reset.
     */
    async redrive(ids?: string[]): Promise<number> {
        const db = this.getDb();
        if (ids && ids.length > 0) {
            const result = await db.update(syncOutbox)
                .set({ status: SYNC_OUTBOX_STATUS.PENDING, lastError: null })
                .where(and(eq(syncOutbox.status, SYNC_OUTBOX_STATUS.FAILED), inArray(syncOutbox.id, ids)))
                .returning({ id: syncOutbox.id });
            return result.length;
        }
        const result = await db.update(syncOutbox)
            .set({ status: SYNC_OUTBOX_STATUS.PENDING, lastError: null })
            .where(eq(syncOutbox.status, SYNC_OUTBOX_STATUS.FAILED))
            .returning({ id: syncOutbox.id });
        return result.length;
    }

    /**
     * Operability snapshot for the sync-health endpoint / console badge:
     * pending + failed counts and the age (seconds) of the oldest pending row
     * (null when none pending).
     */
    async counts(): Promise<{ pending: number; failed: number; oldestPendingAge: number | null }> {
        const db = this.getDb();
        const [pendingRow, failedRow, oldest] = await Promise.all([
            db.select({ n: sql<number>`count(*)` }).from(syncOutbox).where(eq(syncOutbox.status, SYNC_OUTBOX_STATUS.PENDING)).get(),
            db.select({ n: sql<number>`count(*)` }).from(syncOutbox).where(eq(syncOutbox.status, SYNC_OUTBOX_STATUS.FAILED)).get(),
            db.select({ createdAt: syncOutbox.createdAt }).from(syncOutbox)
                .where(eq(syncOutbox.status, SYNC_OUTBOX_STATUS.PENDING))
                .orderBy(asc(syncOutbox.createdAt)).limit(1).get(),
        ]);
        const pending = pendingRow?.n ?? 0;
        const failed = failedRow?.n ?? 0;
        const oldestPendingAge = oldest
            ? Math.max(0, Math.floor((Date.now() - oldest.createdAt.getTime()) / 1000))
            : null;
        return { pending, failed, oldestPendingAge };
    }
}

/**
 * Module-level inline publish used by the DI hook: build a one-shot service
 * bound to `db` and publish a single row to the queue. Errors propagate so the
 * caller (executionCtx.waitUntil(...).catch(...)) can swallow them, leaving the
 * row `pending` for the sweeper.
 */
export async function publishRow(
    db: D1Database,
    queue: Queue<SyncEnvelope>,
    row: OutboxRow,
): Promise<void> {
    await new OutboxService(db).publishRow(queue, row);
}

/**
 * One pass of the scheduled sweeper. Selects `pending` rows older than
 * SWEEP_MIN_AGE_SECONDS (so it does not race the inline publish), and
 * republishes each to the SYNC_QUEUE. Occasional double-publish is absorbed by
 * portal dedup. There is no Service-Binding POST path anymore — the queue is
 * the sole transport.
 */
export async function flushOutboxOnce(
    db: D1Database,
    queue: Queue<SyncEnvelope>,
    limit = 50,
): Promise<{ published: number; pending: number }> {
    const svc = new OutboxService(db);
    const rows = await svc.listPending(limit, SWEEP_MIN_AGE_SECONDS);
    let published = 0;
    let pending = 0;

    for (const row of rows) {
        try {
            await svc.publishRow(queue, row);
            published++;
        } catch (err) {
            // Send failed — row stays `pending`, a later sweep retries.
            logger.warn('[outbox] sweeper publish failed', {
                id: row.id,
                error: err instanceof Error ? err.message : String(err),
            });
            pending++;
        }
    }

    if (rows.length > 0) {
        logger.info('[outbox] sweeper pass', { published, pending, total: rows.length });
    }
    return { published, pending };
}
