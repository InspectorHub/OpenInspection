import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

// Agent Accounts A3 — Concierge magic-link tokens. Single-use, 7-day TTL.
// `confirmed_at` flips to a timestamp when the client redeems the link; the
// row is retained for audit (we don't delete tokens). The expiry index lets
// future cleanup jobs scan stale rows efficiently without a full table scan.
//
// The plaintext token is NEVER stored: the link carries it, `token_hash` is
// what a presented token is looked up by, and there is no second lookup path.
// This table used to make the plaintext column its PRIMARY KEY and fill it with
// a throwaway sentinel on every insert, purely to keep that key unique — which
// left the schema asserting that the secret was stored when it never was, and
// left a hash-miss falling through to a plaintext branch that could only ever
// match a row predating the hash. `id` is the identity now, so both go away.
export const conciergeConfirmTokens = sqliteTable('concierge_confirm_tokens', {
    id:            text('id').primaryKey(),
    tenantId:      text('tenant_id').notNull(),
    // App-layer reference to inspections.id — no DB FK per Schema Rules. The
    // legacy `.references()` this table carried went with the rebuild.
    inspectionId:  text('inspection_id').notNull(),
    clientEmail:   text('client_email').notNull(),
    // SHA-256 hex of the token in the emailed link. NOT NULL: it is the only
    // way a presented token resolves to this row.
    tokenHash:     text('token_hash').notNull(),
    expiresAt:     integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    confirmedAt:   integer('confirmed_at', { mode: 'timestamp_ms' }),
    createdAt:     integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    index('idx_concierge_tokens_expiry').on(t.expiresAt),
    uniqueIndex('idx_concierge_confirm_token_hash').on(t.tokenHash),
]);
