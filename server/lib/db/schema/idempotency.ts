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
    key:            text('key').notNull(),
    fingerprint:    text('fingerprint').notNull(),
    state:          text('state', { enum: ['in_flight', 'done'] }).notNull().default('in_flight'),
    responseStatus: integer('response_status'),
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
