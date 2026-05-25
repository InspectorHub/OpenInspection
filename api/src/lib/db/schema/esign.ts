import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
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
    createdAt:     integer('created_at').notNull(),
    rotatedAt:     integer('rotated_at'),
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
    event:          text('event', { enum: ['request.created', 'request.sent', 'request.viewed', 'agreement.signed', 'workflow.complete'] }).notNull(),
    payloadJson:    text('payload_json').notNull(),
    prevHash:       text('prev_hash'),
    hash:           text('hash').notNull(),
    signature:      text('signature').notNull(),
    keyFingerprint: text('key_fingerprint').notNull(),
    createdAt:      integer('created_at').notNull(),
}, (t) => ({
    idxRequest:    index('idx_esign_audit_logs_request').on(t.tenantId, t.requestId, t.createdAt),
    uqEventDedup:  uniqueIndex('idx_esign_audit_logs_event_dedup').on(t.tenantId, t.requestId, t.event),
}));

export type SigningKey = typeof signingKeys.$inferSelect;
export type NewSigningKey = typeof signingKeys.$inferInsert;
export type EsignAuditLog = typeof esignAuditLogs.$inferSelect;
export type NewEsignAuditLog = typeof esignAuditLogs.$inferInsert;
