import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { tenants } from './tenant';

/**
 * Spec 5H — Self-built e-signature audit foundation.
 * Per-tenant Ed25519 keypair, lazy-created on first sign attempt.
 * Private key encrypted at rest with AES-GCM under KEY_ENCRYPTION_SECRET.
 *
 * **This is a key HISTORY, one row per key, and retiring one never deletes it.**
 * It used to be keyed by `tenant_id` — one row, so rotating meant overwriting,
 * which would have destroyed the public key that sealed every existing chain.
 * Those chains would not have verified as tampered; they would have had no key
 * to check against at all, on the PUBLIC verifier page, for documents real
 * people really signed.
 *
 * What makes rotation safe is not this table alone but the pairing: every audit
 * row records `key_fingerprint`, and the verifiers resolve THAT key rather than
 * the tenant's current one (`audit-log.service.ts`, `report-version.service.ts`).
 * A retired key stays here forever precisely so old evidence keeps verifying —
 * it is evidence about a signature, not a credential, and the private half being
 * retired does not make the public half safe to lose.
 *
 * Two indexes carry the invariants: one key may appear once per tenant, and at
 * most one key per tenant is active (`retired_at IS NULL`, enforced by a PARTIAL
 * unique index, since a plain unique index does not constrain NULLs).
 */
export const signingKeys = sqliteTable('signing_keys', {
    id:            text('id').primaryKey(),
    tenantId:      text('tenant_id').notNull().references(() => tenants.id),
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
    // NULL = this is the tenant's active key, the one new signatures are made
    // with. Set once, on rotation, and never unset. Replaces the old
    // `rotated_at`, which was written as NULL and read by nothing — the rename
    // is not cosmetic: `retired_at` says what is true of the ROW (this key no
    // longer signs), where `rotated_at` read as a fact about the tenant and
    // invited a single-row UPDATE, which is exactly what must never happen here.
    //
    // A retired key is never deleted. Unlike the JWT keyring, whose old kids can
    // be pruned once their sessions expire (`scripts/rotate-jwt-keys.js`), the
    // evidence this key sealed is permanent — so the public half has to outlive
    // the private half by as long as the signatures matter.
    retiredAt:     integer('retired_at', { mode: 'timestamp_ms' }),
}, (t) => ({
    // One row per (tenant, key). Re-running key creation cannot silently fork a
    // tenant's history into two keys with the same fingerprint.
    uqTenantFingerprint: uniqueIndex('uq_signing_keys_tenant_fingerprint')
        .on(t.tenantId, t.fingerprint),
    // At most ONE active key per tenant. Partial on purpose: a plain unique
    // index over (tenant_id, retired_at) would let unlimited rows through,
    // because SQLite treats every NULL as distinct — which is precisely the
    // state this has to forbid.
    uqTenantActive: uniqueIndex('uq_signing_keys_tenant_active')
        .on(t.tenantId)
        .where(sql`retired_at IS NULL`),
}));

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
    event:          text('event', { enum: ['request.created', 'request.sent', 'request.viewed', 'signer.presented', 'agreement.signed', 'agreement.inspector_signed', 'signer.signed', 'signer.declined', 'signer.reminded', 'workflow.complete'] }).notNull(),
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
    // Which signing_keys row signed THIS row, stamped from ensureKeypair. It is
    // what SELECTS the key at verification time, so it is load-bearing rather
    // than informational: verifyChain resolves this fingerprint against the
    // tenant's key history instead of reading whatever key is active now, which
    // is what lets a rotated-away key keep verifying the rows it sealed. A
    // fingerprint with no key on file stops with reason:'key_mismatch' — we
    // could not check, which is not the same as the signature being bad.
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
