import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';

/**
 * Which native app versions a company's devices have been seen running, and when.
 *
 * An installed binary cannot be recalled, so retiring an old version safely means
 * knowing nothing still runs it. `GET /api/client/session` is called by the app
 * on every start and refresh and upserts one row per (company, platform,
 * version). `last_seen_at` is the date to look at before raising
 * `NATIVE_MIN_VERSION_<PLATFORM>`.
 *
 * Writes are throttled (`NATIVE_SEEN_REFRESH_MS`) so a busy fleet costs about one
 * write per version per hour, and a company holds at most
 * `NATIVE_SEEN_MAX_ROWS_PER_TENANT` rows so a client that invents version strings
 * cannot grow the table. The version is stored in its normalized three-component
 * form (`1.4` is stored as `1.4.0`).
 *
 * Referential integrity is enforced by the service layer (no foreign keys). A
 * tenant purge removes the rows (they carry `tenant_id`).
 */
export const nativeClientSeen = sqliteTable('native_client_seen', {
    tenantId:      text('tenant_id').notNull(),
    platform:      text('platform', { enum: ['ios', 'android', 'windows'] }).notNull(),
    clientVersion: text('client_version').notNull(),
    firstSeenAt:   integer('first_seen_at', { mode: 'timestamp_ms' }).notNull(),
    lastSeenAt:    integer('last_seen_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    primaryKey({ columns: [t.tenantId, t.platform, t.clientVersion] }),
]);

export type NativeClientSeen = typeof nativeClientSeen.$inferSelect;
