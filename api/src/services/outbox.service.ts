import { drizzle } from 'drizzle-orm/d1';
import { eq, and, asc } from 'drizzle-orm';
import { syncOutbox } from '../lib/db/schema';
import { logger } from '../lib/logger';

/**
 * Core → Portal sync outbox.
 *
 * Append captures a single user-lifecycle event in the same DB write
 * that produced the underlying mutation (callers should batch the
 * insert with their own change via db.batch when possible). FlushPending
 * is invoked by the scheduled worker and posts every pending row to
 * portal's `/api/integration/from-core` endpoint.
 *
 * Portal dedupes by row id, so retries here are idempotent on the
 * receiving side.
 */

export type OutboxEventType =
    | 'user.invited'
    | 'user.password_changed'
    | 'user.deleted';

export interface OutboxEvent {
    type: OutboxEventType;
    // The payload is event-specific JSON. Kept loose here since the
    // schema for each event is defined at the receiver side.
    payload: Record<string, unknown>;
}

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

export class OutboxService {
    constructor(private db: D1Database) {}

    private getDb() {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return drizzle(this.db as any);
    }

    /**
     * Append a new pending event. Caller usually wraps this in a
     * db.batch() alongside the source mutation to keep the two atomic.
     * Returns the generated event id (= the dedup key portal sees).
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
        return id;
    }

    /**
     * Read pending events, oldest first, up to `limit`. Used by the
     * scheduled flush worker. Returned rows still have status='pending';
     * the worker calls markDone / markFailed after each delivery.
     */
    async listPending(limit = 50): Promise<OutboxRow[]> {
        const rows = await this.getDb()
            .select()
            .from(syncOutbox)
            .where(eq(syncOutbox.status, 'pending'))
            .orderBy(asc(syncOutbox.createdAt))
            .limit(limit)
            .all();
        return rows as unknown as OutboxRow[];
    }

    async markDone(id: string): Promise<void> {
        await this.getDb().update(syncOutbox)
            .set({ status: 'done', lastTriedAt: Math.floor(Date.now() / 1000), lastError: null })
            .where(eq(syncOutbox.id, id));
    }

    /**
     * Mark a single attempt as failed. If `permanent` is true the row
     * moves to status='failed' and stops being retried (only set this
     * for 4xx responses where the receiver explicitly rejected the
     * payload — retrying won't help). Otherwise the row stays
     * pending, just with bumped `attempts` + `lastError` + `lastTriedAt`.
     */
    async markFailed(id: string, error: string, permanent = false): Promise<void> {
        const now = Math.floor(Date.now() / 1000);
        if (permanent) {
            await this.getDb().update(syncOutbox)
                .set({ status: 'failed', lastTriedAt: now, lastError: error.slice(0, 1000) })
                .where(eq(syncOutbox.id, id));
            return;
        }
        // Bump attempts via a raw read-modify-write — Drizzle's set() doesn't
        // expose sql expressions in the typed builder for this column shape.
        const row = await this.getDb().select({ attempts: syncOutbox.attempts })
            .from(syncOutbox).where(eq(syncOutbox.id, id)).get();
        const attempts = (row?.attempts ?? 0) + 1;
        await this.getDb().update(syncOutbox)
            .set({ attempts, lastTriedAt: now, lastError: error.slice(0, 1000) })
            .where(and(eq(syncOutbox.id, id), eq(syncOutbox.status, 'pending')));
    }
}

/**
 * One pass of the scheduled flush. Posts each pending row to the
 * portal receiver. The worker (src/scheduled.ts) wraps this and gates
 * how often it runs.
 *
 * - 2xx → markDone
 * - 4xx (except 409 conflict-on-dedup-id, which means portal already
 *   has this event and we should also mark done) → markFailed permanent
 * - 5xx / network → markFailed transient (attempts++)
 *
 * The HMAC scheme reuses the existing portal-↔-core M2M secret
 * (PORTAL_M2M_SECRET_V*). Portal validates the same way it validates
 * its own outbound calls to core.
 */
export async function flushOutboxOnce(
    db: D1Database,
    portalBaseUrl: string,
    m2mSecret: string,
    limit = 50,
): Promise<{ posted: number; pending: number; failed: number }> {
    const svc = new OutboxService(db);
    const rows = await svc.listPending(limit);
    let posted = 0;
    let pending = 0;
    let failed = 0;

    for (const row of rows) {
        const body = JSON.stringify({
            id: row.id,
            type: row.eventType,
            payload: JSON.parse(row.payload),
            attempt: row.attempts + 1,
        });
        const ts = Math.floor(Date.now() / 1000).toString();
        const sig = await hmacSign(m2mSecret, `${ts}.${body}`);

        try {
            const res = await fetch(`${portalBaseUrl}/api/integration/from-core`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-portal-signature': `${ts}.${sig}`,
                },
                body,
            });
            if (res.ok || res.status === 409) {
                await svc.markDone(row.id);
                posted++;
            } else if (res.status >= 400 && res.status < 500) {
                const text = await res.text().catch(() => '');
                await svc.markFailed(row.id, `${res.status}: ${text}`, true);
                failed++;
            } else {
                const text = await res.text().catch(() => '');
                await svc.markFailed(row.id, `${res.status}: ${text}`, false);
                pending++;
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            await svc.markFailed(row.id, msg, false);
            pending++;
        }
    }

    if (rows.length > 0) {
        logger.info('[outbox] flush pass', { posted, pending, failed, total: rows.length });
    }
    return { posted, pending, failed };
}

async function hmacSign(secret: string, message: string): Promise<string> {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
        'raw', enc.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false, ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
    return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}
