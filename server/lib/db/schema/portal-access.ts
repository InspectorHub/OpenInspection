import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { tenants } from './tenant';

/**
 * Persistent per-(recipient, order) portal access tokens (Magic-Link, no-login).
 *
 * ONE stable row per (inspection, recipient); the token does NOT rotate per
 * email-send (so every automation email/SMS reuses the same link across the
 * order lifecycle — sign → pay → view report → download PDF). Each recipient
 * (client / co_client / agent) gets a distinct token for attribution.
 *
 * Lifecycle: issued on order-create / recipient-add; `expiresAt` set ~30–60d
 * after report delivery; `revokedAt` set by the inspector "Reset access link".
 * Timestamps are plain epoch-ms integers (numeric comparison in the guard).
 * See memory project_client_portal_token_model.
 */
export const inspectionAccessTokens = sqliteTable('inspection_access_tokens', {
    id:             text('id').primaryKey(),
    tenantId:       text('tenant_id').notNull().references(() => tenants.id),
    inspectionId:   text('inspection_id').notNull(),
    recipientEmail: text('recipient_email').notNull(),
    // Free-form role-profile KEY (validated against the tenant's
    // contact_role_profiles by PortalAccessService.issueToken) — NOT a fixed
    // drizzle enum. SQLite stores plain TEXT; this is a type-layer widening
    // only, no DDL/migration cost. See spec 2026-07-16-oi-people-role-profiles.
    role:           text('role').notNull().default('client'),
    token:          text('token').notNull(),
    createdAt:      integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    expiresAt:      integer('expires_at', { mode: 'timestamp_ms' }),   // null = open (order active)
    revokedAt:      integer('revoked_at', { mode: 'timestamp_ms' }),   // null = live
    tokenHash:      text('token_hash'),
    tokenEnc:       text('token_enc'),
}, (t) => [
    uniqueIndex('idx_iat_token').on(t.token),
    index('idx_iat_inspection').on(t.tenantId, t.inspectionId),
    uniqueIndex('idx_iat_recipient').on(t.inspectionId, t.recipientEmail),
    uniqueIndex('idx_iat_token_hash').on(t.tokenHash),
]);
