import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
import { tenants, users } from '../tenant';
import { inspections } from './core';

export const agreements = sqliteTable('agreements', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id),
    name: text('name').notNull(),
    content: text('content').notNull(),
    version: integer('version').notNull().default(1),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    index('idx_agreements_tenant').on(t.tenantId),
]);

export const agreementRequests = sqliteTable('agreement_requests', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id),
    // Every agreement envelope is bound to an inspection (the send UI + every
    // service path require it). NOT NULL since the 2026-06-21 consolidation.
    inspectionId: text('inspection_id').notNull().references(() => inspections.id),
    agreementId: text('agreement_id').notNull().references(() => agreements.id),
    clientEmail: text('client_email').notNull(),
    clientName: text('client_name'),
    // Internal envelope handle: a throwaway, NEVER-distributed UUID written by
    // findOrCreate to satisfy NOT NULL + UNIQUE. Public links use per-signer
    // tokenHash; the /sign/:id redirect resolves an envelope via this through
    // getSignerByPresentedToken's synthesize fallback. Not a distributed secret.
    token: text('token').notNull().unique(),
    status: text('status', { enum: ['pending', 'sent', 'viewed', 'signed', 'declined', 'expired'] }).notNull().default('pending'),
    // LEGACY envelope-level client signature — superseded for NEW writes by
    // agreement_signers.signatureBase64 / .signedAt (findOrCreate no longer
    // writes these). NOT frozen: still READ by live paths — the render fallback
    // for pre-signer-model envelopes (agreements-render.ts), the GDPR retention
    // sweep (retention-sweep.ts filters/destroys on signed_at), publish-readiness
    // (inspection-publish.service.ts), and the tenant data export
    // (admin.service.ts). Migrate those readers to signer-level data before
    // freezing/retiring these columns.
    signatureBase64: text('signature_base64'),
    signedAt: integer('signed_at', { mode: 'timestamp_ms' }),
    viewedAt: integer('viewed_at', { mode: 'timestamp_ms' }),
    sentAt: integer('sent_at', { mode: 'timestamp_ms' }),
    lastError: text('last_error'),
    // Spec 5H D1 — optional inspector pre-sign. NULL until inspector signs.
    inspectorSignatureBase64: text('inspector_signature_base64'),
    inspectorSignedAt:        integer('inspector_signed_at', { mode: 'timestamp_ms' }),
    inspectorUserId:          text('inspector_user_id').references(() => users.id),
    // Spec 5H P2 — opaque public-verifier token. Set on the sign event.
    verificationToken: text('verification_token'),
    // Track I-a (#116) — immutable content snapshot pinned at envelope creation.
    // Public sign page + checkout + verifier + signed.pdf ALL render this, never
    // the live template. NULL only on pre-feature signed envelopes (verifier
    // shows a "snapshot predates this feature" notice).
    contentSnapshot: text('content_snapshot'),
    contentHash:     text('content_hash'),                // SHA-256 hex of contentSnapshot
    completionPolicy: text('completion_policy', { enum: ['all', 'one'] }).notNull().default('all'),
    tokenHash:       text('token_hash'),                  // lazy hash upgrade of legacy plaintext `token`
    // Track I-a GDPR (spec §7) — final-destruction marker. NULL while the signed
    // evidence is within its retention window; set to the sweep timestamp when the
    // daily retention sweep destroys signature_base64 past the window. Distinct
    // from `status` (which stays the truthful 'signed' — the agreement WAS signed
    // and the esign_audit_logs chain still attests it); this is the idempotency
    // guard so a re-run skips already-purged rows. No PII.
    purgedAt:        integer('purged_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    uniqueIndex('idx_agreement_requests_verify_token').on(t.verificationToken),
    index('idx_agreement_requests_tenant').on(t.tenantId),
    index('idx_agreement_requests_inspection').on(t.inspectionId),
    uniqueIndex('idx_agreement_requests_token_hash').on(t.tokenHash),
]);

// Track I-a (#117) — 1:N signer records under an agreement_requests envelope.
// App-layer refs only (no DB FKs per Schema Rules). Signer tokens are tier-2
// hash-at-rest: token_hash for lookup, token_enc (KEK-sealed plaintext) for
// server-side link reconstruction (gate CTA / reminders / Copy link).
export const agreementSigners = sqliteTable('agreement_signers', {
    id:                 text('id').primaryKey(),
    tenantId:           text('tenant_id').notNull(),     // → tenants.id (app-layer; FK intentionally omitted per Schema Rules)
    requestId:          text('request_id').notNull(),     // → agreement_requests.id (app-layer)
    name:               text('name').notNull(),
    email:              text('email').notNull(),
    role:               text('role', { enum: ['client', 'co_client', 'agent', 'other'] }).notNull().default('client'),
    contactId:          text('contact_id'),               // → contacts.id (app-layer, optional)
    tokenHash:          text('token_hash'),               // SHA-256 hex; NULL on backfilled rows until first link build
    tokenEnc:           text('token_enc'),                // 't1:iv:cipher' sealed plaintext (config-crypto sealToken)
    status:             text('status', { enum: ['pending', 'sent', 'viewed', 'signed', 'declined', 'expired'] }).notNull().default('pending'),
    signatureBase64:    text('signature_base64'),
    signedAt:           integer('signed_at', { mode: 'timestamp_ms' }),
    viewedAt:           integer('viewed_at', { mode: 'timestamp_ms' }),
    ipAddress:          text('ip_address'),
    userAgent:          text('user_agent'),
    channel:            text('channel', { enum: ['remote', 'in_person'] }), // set at sign time
    onBehalfOf:         text('on_behalf_of'),             // client name an authorized agent signs for
    onBehalfDisclaimer: text('on_behalf_disclaimer'),     // disclaimer text snapshot shown at sign time
    lastRemindedAt:     integer('last_reminded_at', { mode: 'timestamp_ms' }),
    createdAt:          integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    index('idx_agreement_signers_tenant_request').on(t.tenantId, t.requestId),
    uniqueIndex('idx_agreement_signers_request_email').on(t.requestId, t.email),
    uniqueIndex('idx_agreement_signers_token_hash').on(t.tokenHash),
]);
