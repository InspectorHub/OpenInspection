/**
 * Design System 0520 subsystem C phase 1 — GuestInvites.
 *
 * One row per shareable invite link the admin mints. Guests sign up
 * through /api/guest/claim using the token; their resulting `users` row
 * carries the matching role + an `expires_at` so the daily cron can
 * auto-revoke when the duration ends.
 *
 * Per the simplified seat-quota model (spec amendment): guests count
 * against tenants.max_users on claim — no separate per-guest billing.
 */
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const guestInvites = sqliteTable('guest_invites', {
    id:                text('id').primaryKey(),
    tenantId:          text('tenant_id').notNull(),
    token:             text('token').notNull().unique(),
    role:              text('role', { enum: ['lead', 'specialist', 'apprentice', 'office'] }).notNull(),
    durationSeconds:   integer('duration_seconds').notNull(),
    expiresAt:         integer('expires_at').notNull(),
    claimedByUserId:   text('claimed_by_user_id'),
    claimedAt:         integer('claimed_at'),
    createdBy:         text('created_by').notNull(),
    createdAt:         text('created_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
    index('guest_invites_tenant_idx').on(t.tenantId),
]);
