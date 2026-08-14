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
    // base64url SPKI. Stored in the clear on purpose: it is what a third party
    // needs to check the seal, served as PEM from /.well-known and embedded in
    // the audit-trail export so an offline verifier needs nothing from us.
    publicKey:     text('public_key').notNull(),
    privateKeyEnc: text('private_key_enc').notNull(),
    // base64url 12-byte AES-GCM IV for privateKeyEnc, freshly random per keypair.
    // Not a secret, but not optional either: without it the private key cannot be
    // decrypted and the tenant can never sign again under this fingerprint.
    privateKeyIv:  text('private_key_iv').notNull(),
    // SHA-256 hex of the raw SPKI bytes. Copied onto every audit row's
    // key_fingerprint at append time and published by the verifier, so a reader
    // can say WHICH key signed rather than trusting that one exists.
    fingerprint:   text('fingerprint').notNull(),
    // NO READER FOUND. Every surface that reports an algorithm — /.well-known,
    // the public verifier JSON, the audit-trail export — emits the 'Ed25519'
    // literal instead of reading this column.
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
    // The dedup key (with tenant + request) for the partial index below, and the
    // label the admin audit trail and the downloadable evidence JSON print. NOT
    // inside the hash — that covers payload_json + prev_hash only — so
    // verifyChain cannot detect an edited label. The payload is the evidence.
    event:          text('event', { enum: ['request.created', 'request.sent', 'request.viewed', 'agreement.signed', 'agreement.inspector_signed', 'signer.signed', 'signer.declined', 'signer.reminded', 'workflow.complete'] }).notNull(),
    payloadJson:    text('payload_json').notNull(),
    prevHash:       text('prev_hash'),
    // The chain link: the next row's prev_hash is a copy of this. verifyChain
    // recomputes it, so a rewritten payload_json fails as reason:'hash' and an
    // unlinked or reordered row fails as reason:'chain', naming brokenAt.
    hash:           text('hash').notNull(),
    // base64url Ed25519 over the HEX-DECODED hash bytes. This is what makes the
    // chain more than a checksum: recomputing hashes after editing a payload
    // still fails (reason:'signature') without the tenant's private key.
    signature:      text('signature').notNull(),
    // Which signing_keys row signed THIS row, stamped from ensureKeypair.
    // verifyChain does not read it — it always verifies against the tenant's
    // current key — so it exists to tell a reader (and a future rotation) which
    // key a row was sealed with.
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
