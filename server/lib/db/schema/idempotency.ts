import { sqliteTable, text, integer, primaryKey, index } from 'drizzle-orm/sqlite-core';

/**
 * Generic idempotency store (portal #107).
 *
 * One row per (tenant, key). The row IS the lock: `claim` inserts it, and a
 * concurrent request that fails to insert knows someone else owns the work.
 * That is why there is no separate lock table and no polling.
 *
 * The key is scoped to the TENANT, not global. A bare key is a shared
 * namespace: two tenants that mint the same key would replay each other's
 * stored response, which is a cross-tenant leak introduced by a correctness
 * fix. `tenant_id` is therefore half of the primary key, and callers read it
 * from the authenticated context — never from the request body.
 *
 * `responseBody` is the serialized success response, replayed verbatim so a
 * retry is indistinguishable from the original call.
 */
export const idempotencyKeys = sqliteTable('idempotency_keys', {
    tenantId:       text('tenant_id').notNull(),
    // The caller's `Idempotency-Key` header, verbatim. Clients mint one per
    // INTENT and hold it across failures, which is why `releaseKey` DELETES the
    // row on a non-2xx: the corrected retry has to be able to reclaim the key.
    key:            text('key').notNull(),
    // SHA-256 of `METHOD path <canonicalized JSON body>`. Compared BEFORE
    // `state`: a key replayed with a different payload gets 422
    // IDEMPOTENCY_KEY_REUSED, never the stored response — handing back a
    // pre-edit result is a lost write. Non-JSON bodies fingerprint as `null`.
    fingerprint:    text('fingerprint').notNull(),
    // 'in_flight' IS the claim — it is what the insert writes, and a conflicting
    // caller gets 409. Nothing sweeps aged-out rows, so `claimKey` STEALS an
    // 'in_flight' row past expiresAt with one conditional UPDATE; otherwise a
    // holder killed mid-request would lock a webhook out forever.
    state:          text('state', { enum: ['in_flight', 'done'] }).notNull().default('in_flight'),
    responseStatus: integer('response_status'),
    // The 2xx response text, buffered off a clone of the live response and
    // replayed verbatim with an `Idempotency-Replayed: true` header. NULL while
    // in_flight; only `state = 'done'` makes it meaningful.
    responseBody:   text('response_body'),
    createdAt:      integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    expiresAt:      integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    primaryKey({ columns: [t.tenantId, t.key] }),
    // Sweep read: "which claims have aged out?" (TTL is 24h — retries happen in
    // seconds, so anything older is a different problem).
    index('idx_idempotency_expires').on(t.expiresAt),
]);

export type IdempotencyKey = typeof idempotencyKeys.$inferSelect;
export type NewIdempotencyKey = typeof idempotencyKeys.$inferInsert;
