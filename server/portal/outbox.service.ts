import { drizzle } from 'drizzle-orm/d1';
import { eq, and, asc, lt, sql, inArray } from 'drizzle-orm';
import { syncOutbox } from '../lib/db/schema';
import { logger } from '../lib/logger';
import { toCloudEvent } from '../lib/sync-events/envelope';
import type { SyncEnvelope } from '../lib/sync-events/envelope';
import type { UserSyncEvent, UserSyncEventType, UserSyncOutbox } from '../lib/integration/user-sync';

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
type CmdReplyEventType = 'reply.tenant.updated' | 'reply.tenant.export_completed' | 'reply.tenant.purged';
export type OutboxEventType = UserSyncEventType | CmdReplyEventType;
export type OutboxEvent = UserSyncEvent | {
    type: CmdReplyEventType;
    payload: Record<string, unknown>;
};

export interface OutboxRow {
    id: string;
    eventType: string;
    payload: string;          // JSON-encoded
    status: string;
    attempts: number;
    createdAt: number;
    lastTriedAt: number | null;
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

    private getDb() {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return drizzle(this.db as any);
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
        const now = Math.floor(Date.now() / 1000);
        await this.getDb().insert(syncOutbox).values({
            id,
            eventType: event.type,
            payload: JSON.stringify(event.payload),
            status: 'pending',
            attempts: 0,
            createdAt: now,
        });
        if (this.publish) {
            this.publish({
                id,
                eventType: event.type,
                payload: JSON.stringify(event.payload),
                status: 'pending',
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
                eq(syncOutbox.status, 'pending'),
                lt(syncOutbox.createdAt, Math.floor(Date.now() / 1000) - olderThanSeconds),
            ))
            : base.where(eq(syncOutbox.status, 'pending')))
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
            .set({ status: 'published', lastTriedAt: Math.floor(Date.now() / 1000), lastError: null })
            .where(eq(syncOutbox.id, row.id));
    }

    /**
     * DLQ writeback: a message exhausted its consumer retries and landed on the
     * dead-letter queue. Mark the originating row `failed` + record the error +
     * bump attempts. This D1 row is the durable failure record (the free-tier
     * 24h DLQ retention is irrelevant). Surfaced by counts() / the console.
     */
    async markFailedFromDlq(id: string, error: string): Promise<void> {
        const now = Math.floor(Date.now() / 1000);
        const row = await this.getDb().select({ attempts: syncOutbox.attempts })
            .from(syncOutbox).where(eq(syncOutbox.id, id)).get();
        const attempts = (row?.attempts ?? 0) + 1;
        await this.getDb().update(syncOutbox)
            .set({ status: 'failed', attempts, lastTriedAt: now, lastError: error.slice(0, 1000) })
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
                .set({ status: 'pending', lastError: null })
                .where(and(eq(syncOutbox.status, 'failed'), inArray(syncOutbox.id, ids)))
                .returning({ id: syncOutbox.id });
            return result.length;
        }
        const result = await db.update(syncOutbox)
            .set({ status: 'pending', lastError: null })
            .where(eq(syncOutbox.status, 'failed'))
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
            db.select({ n: sql<number>`count(*)` }).from(syncOutbox).where(eq(syncOutbox.status, 'pending')).get(),
            db.select({ n: sql<number>`count(*)` }).from(syncOutbox).where(eq(syncOutbox.status, 'failed')).get(),
            db.select({ createdAt: syncOutbox.createdAt }).from(syncOutbox)
                .where(eq(syncOutbox.status, 'pending'))
                .orderBy(asc(syncOutbox.createdAt)).limit(1).get(),
        ]);
        const pending = pendingRow?.n ?? 0;
        const failed = failedRow?.n ?? 0;
        const oldestPendingAge = oldest
            ? Math.max(0, Math.floor(Date.now() / 1000) - oldest.createdAt)
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
