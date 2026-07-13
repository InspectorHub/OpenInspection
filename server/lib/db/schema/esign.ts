import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { tenants } from './tenant';

/**
 * Spec 5H — Self-built e-signature audit foundation.
 * Per-tenant Ed25519 keypair, lazy-created on first sign attempt.
 * Private key encrypted at rest with AES-GCM under KEY_ENCRYPTION_SECRET.
 */
export const signingKeys = sqliteTable('signing_keys', {
    tenantId:      text('tenant_id').primaryKey().references(() => tenants.id),
    publicKey:     text('public_key').notNull(),
    privateKeyEnc: text('private_key_enc').notNull(),
    privateKeyIv:  text('private_key_iv').notNull(),
    fingerprint:   text('fingerprint').notNull(),
    algorithm:     text('algorithm').notNull().default('Ed25519'),
    createdAt:     integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    rotatedAt:     integer('rotated_at', { mode: 'timestamp_ms' }),
});

/**
 * Spec 5H — Hash-chained, Ed25519-signed audit events.
 * One chain per agreement_request. hash = SHA-256(payload_json + (prev_hash ?? '')).
 * Tampering with any row breaks the chain at that row AND invalidates the signature.
 */
export const esignAuditLogs = sqliteTable('esign_audit_logs', {
    id:             text('id').primaryKey(),
    tenantId:       text('tenant_id').notNull(),
    requestId:      text('request_id').notNull(),
    event:          text('event', { enum: ['request.created', 'request.sent', 'request.viewed', 'agreement.signed', 'agreement.inspector_signed', 'signer.signed', 'signer.declined', 'signer.reminded', 'workflow.complete'] }).notNull(),
    payloadJson:    text('payload_json').notNull(),
    prevHash:       text('prev_hash'),
    hash:           text('hash').notNull(),
    signature:      text('signature').notNull(),
    keyFingerprint: text('key_fingerprint').notNull(),
    createdAt:      integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => ({
    idxRequest:    index('idx_esign_audit_logs_request').on(t.tenantId, t.requestId, t.createdAt),
    // Track I-a — PARTIAL dedup index. Envelope-level events (request.created,
    // agreement.signed, workflow.complete, …) fire at most once per envelope, so
    // the unique constraint keeps their anti-double-fire / idempotency guarantee.
    // Per-signer events (signer.signed, signer.declined) fire ONCE PER SIGNER and
    // a multi-signer envelope legitimately appends the same event type N times —
    // the `event NOT LIKE 'signer.%'` predicate excludes them so each signer's
    // evidence row is preserved (the chain links them by prev_hash regardless).
    uqEventDedup:  uniqueIndex('idx_esign_audit_logs_event_dedup')
        .on(t.tenantId, t.requestId, t.event)
        .where(sql`event NOT LIKE 'signer.%'`),
}));

export type SigningKey = typeof signingKeys.$inferSelect;
export type NewSigningKey = typeof signingKeys.$inferInsert;
export type EsignAuditLog = typeof esignAuditLogs.$inferSelect;
export type NewEsignAuditLog = typeof esignAuditLogs.$inferInsert;
