import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
import { inspections } from './core';

// Agent Accounts A3 — Concierge magic-link tokens. Single-use, 7-day TTL.
// `confirmed_at` flips to a timestamp when the client redeems the link; the
// row is retained for audit (we don't delete tokens). The expiry index lets
// future cleanup jobs scan stale rows efficiently without a full table scan.
export const conciergeConfirmTokens = sqliteTable('concierge_confirm_tokens', {
    token:         text('token').primaryKey(),
    inspectionId:  text('inspection_id').notNull().references(() => inspections.id),
    tenantId:      text('tenant_id').notNull(),
    clientEmail:   text('client_email').notNull(),
    expiresAt:     integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    confirmedAt:   integer('confirmed_at', { mode: 'timestamp_ms' }),
    tokenHash:     text('token_hash'),
    createdAt:     integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    index('idx_concierge_tokens_expiry').on(t.expiresAt),
    uniqueIndex('idx_concierge_confirm_token_hash').on(t.tokenHash),
]);
