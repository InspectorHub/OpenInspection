/**
 * The idempotency key store — all SQL for the feature lives here.
 *
 * THE ROW IS THE LOCK. `claimKey` inserts the row; whoever's insert lands owns
 * the work, and a concurrent caller whose insert conflicts learns that from the
 * conflict itself. There is no separate lock table and nothing to poll, so
 * there is no window in which two callers both believe they hold the claim.
 *
 * Kept free of Hono and of anything outside `server/lib/` so portal can vendor
 * it byte-for-byte.
 */
import { and, eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { idempotencyKeys } from '../db/schema/idempotency';

export interface ClaimArgs {
    /** From the authenticated context. NEVER from the request body — see the schema. */
    tenantId: string;
    key: string;
    fingerprint: string;
    ttlMs: number;
}

export type ClaimResult =
    | 'claimed'
    | { state: 'done'; status: number; body: string }
    | { state: 'in_flight' }
    | { state: 'fingerprint_mismatch' };

export async function claimKey(db: DrizzleD1Database, args: ClaimArgs): Promise<ClaimResult> {
    const now = Date.now();
    const inserted = await db
        .insert(idempotencyKeys)
        .values({
            tenantId:    args.tenantId,
            key:         args.key,
            fingerprint: args.fingerprint,
            state:       'in_flight',
            createdAt:   new Date(now),
            expiresAt:   new Date(now + args.ttlMs),
        })
        .onConflictDoNothing()
        .returning({ key: idempotencyKeys.key });

    if (inserted.length > 0) return 'claimed';

    const [row] = await db
        .select()
        .from(idempotencyKeys)
        .where(and(eq(idempotencyKeys.tenantId, args.tenantId), eq(idempotencyKeys.key, args.key)))
        .limit(1);

    // The row was swept between the insert and this read. Refusing is the safe
    // direction: a retry a moment later claims cleanly, whereas running the
    // handler here would be the duplicate this whole feature exists to prevent.
    if (!row) return { state: 'in_flight' };

    // Fingerprint first, ahead of state. A key replayed with a different
    // payload must never receive the stored response — the caller edited
    // something, and handing back the pre-edit result is a lost write.
    if (row.fingerprint !== args.fingerprint) return { state: 'fingerprint_mismatch' };

    if (row.state === 'done') {
        return { state: 'done', status: row.responseStatus ?? 200, body: row.responseBody ?? '' };
    }
    return { state: 'in_flight' };
}

export interface CompleteArgs {
    tenantId: string;
    key: string;
    status: number;
    body: string;
}

export async function completeKey(db: DrizzleD1Database, args: CompleteArgs): Promise<void> {
    await db
        .update(idempotencyKeys)
        .set({ state: 'done', responseStatus: args.status, responseBody: args.body })
        .where(and(eq(idempotencyKeys.tenantId, args.tenantId), eq(idempotencyKeys.key, args.key)));
}
