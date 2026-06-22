/**
 * Design System 0520 subsystem D phase 4 — ObserverLink (no-account read-only).
 *
 * Mint one row per shareable link; the token goes into a `__Host-observer_session`
 * HMAC-signed cookie at /observe/:token. Cookie carries the inspectionId so
 * subsequent /observe/inspections/:id pages verify scope without re-reading
 * the DB on every request.
 *
 * No `users` row is created — observers do not consume the seat quota.
 */
import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const observerLinks = sqliteTable('observer_links', {
    id:              text('id').primaryKey(),
    tenantId:        text('tenant_id').notNull(),
    inspectionId:    text('inspection_id').notNull(),
    token:           text('token').notNull().unique(),
    createdBy:       text('created_by').notNull(),
    createdAt:       text('created_at').notNull().default(sql`(datetime('now'))`),
    expiresAt:       integer('expires_at').notNull(),
    revokedAt:       integer('revoked_at'),
    lastViewedAt:    integer('last_viewed_at'),
    tokenHash:       text('token_hash'),
    tokenEnc:        text('token_enc'),
}, (t) => [
    index('idx_observer_links_inspection').on(t.inspectionId),
    uniqueIndex('idx_observer_links_token_hash').on(t.tokenHash),
]);
