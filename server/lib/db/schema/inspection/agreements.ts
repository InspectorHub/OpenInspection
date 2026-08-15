import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
import { tenants, users } from '../tenant';
import { inspections } from './core';

export const agreements = sqliteTable('agreements', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id),
    name: text('name').notNull(),
    // The tenant's template body, run through sanitizeAgreementHtml on EVERY
    // create/update (never trusted as stored). findOrCreate copies it into
    // agreement_requests.contentSnapshot, so editing it here can never change
    // what an already-sent envelope shows or what its contentHash covers.
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
    status: text('status', { enum: ['pending', 'sent', 'viewed', 'signed', 'declined', 'expired'] }).notNull().default('pending'),
    // Envelope completion time — THAT it completed and WHEN, which is the
    // envelope's own fact. The signature is not: it belongs to the person who
    // made it and lives on their `agreement_signers` row. Read by the GDPR
    // retention sweep (its window is computed from this), publish-readiness,
    // and the data export.
    signedAt: integer('signed_at', { mode: 'timestamp_ms' }),
    viewedAt: integer('viewed_at', { mode: 'timestamp_ms' }),
    sentAt: integer('sent_at', { mode: 'timestamp_ms' }),
    // The decline REASON, truncated to 500 chars. Written only by
    // markDeclinedBySigner, and only when the signer's decline actually drags the
    // envelope aggregate to 'declined' — a decline that leaves a 'one'-policy
    // envelope live records nothing here. No UI reads it; it reaches the admin
    // envelope-detail JSON as part of the full row and is deliberately left out
    // of the tenant data export. Not an error from a send attempt.
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
    // The reduction computeEnvelopeStatus applies to the signer rows to derive
    // this envelope's status. Set by findOrCreate from the send modal's radio;
    // the send endpoints default a SINGLE-recipient envelope to 'one' and any
    // multi-recipient one to 'all'. mergeSignersIntoEnvelope may still change it
    // while nothing has been signed, never after — it decides whether an already
    // collected signature was enough.
    completionPolicy: text('completion_policy', { enum: ['all', 'one'] }).notNull().default('all'),
    tokenHash:       text('token_hash'),                  // lazy hash upgrade of legacy plaintext `token`
    // Track I-a GDPR (spec §7) — final-destruction marker. NULL while the signed
    // evidence is within its retention window; set to the sweep timestamp when the
    // daily retention sweep destroys the signer rows' signatures past the window
    // (the envelope holds none of its own). Distinct
    // from `status` (which stays the truthful 'signed' — the agreement WAS signed
    // and the esign_audit_logs chain still attests it); this is the idempotency
    // guard so a re-run skips already-purged rows. No PII.
    purgedAt:        integer('purged_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    // The contracting identity AS OF envelope creation. Separate columns, NOT
    // folded into contentSnapshot: contentHash is SHA-256 over the stored
    // snapshot string, so adding a field there would invalidate every signature
    // ever collected.
    //
    // Appended at the table end — agreement_requests is FK-referenced and a
    // mid-table add triggers a drizzle full-table rebuild (same rule as the
    // expiresAt/revokedAt note on agreement_signers below).
    //
    // NULL means NOT RECORDED, and must render as such. Backfilling an old
    // envelope with today's name asserts something untrue about what was signed.
    signerLegalName:   text('signer_legal_name'),
    signerCompanyName: text('signer_company_name'),
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
    // A LABEL on the signing party, not a permission: nothing branches on it.
    // Every signer holds the same token-scoped rights. It is rendered as a Pill
    // on the admin SignerList, in the public verifier roster, and under each
    // signature cell of the signed PDF. Distinct axis from users.role (RBAC) and
    // contact_role_profiles.kind (portal capabilities).
    role:               text('role', { enum: ['client', 'co_client', 'agent', 'other'] }).notNull().default('client'),
    contactId:          text('contact_id'),               // → contacts.id (app-layer, optional)
    tokenHash:          text('token_hash'),               // SHA-256 hex; NULL on backfilled rows until first link build
    tokenEnc:           text('token_enc'),                // 't1:iv:cipher' sealed plaintext (config-crypto sealToken)
    status:             text('status', { enum: ['pending', 'sent', 'viewed', 'signed', 'declined', 'expired'] }).notNull().default('pending'),
    // The drawn signature image. Bare base64 OR a full `data:` URL — both are
    // accepted, and agreements-render prefixes the bare form when composing the
    // signed PDF. Written only by markSignedBySigner. A DSAR erase KEEPS it (it
    // is the retained evidence); the retention sweep NULLs it past the window,
    // which is the one column that separates those two paths.
    signatureBase64:    text('signature_base64'),
    signedAt:           integer('signed_at', { mode: 'timestamp_ms' }),
    viewedAt:           integer('viewed_at', { mode: 'timestamp_ms' }),
    // Captured from cf-connecting-ip (x-forwarded-for as fallback) at sign time
    // and printed in the signed-confirmation email and the audit trail. NULL
    // means either header-less (in-person API sign) or already anonymized —
    // ANONYMIZE_SIGNER_PII nulls both this and userAgent.
    ipAddress:          text('ip_address'),
    // The signer's User-Agent, truncated to 200 chars at the route. Evidence
    // only: nothing branches on it, and it is anonymized with ipAddress above.
    userAgent:          text('user_agent'),
    channel:            text('channel', { enum: ['remote', 'in_person'] }), // set at sign time
    onBehalfOf:         text('on_behalf_of'),             // client name an authorized agent signs for
    onBehalfDisclaimer: text('on_behalf_disclaimer'),     // disclaimer text snapshot shown at sign time
    lastRemindedAt:     integer('last_reminded_at', { mode: 'timestamp_ms' }),
    createdAt:          integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    // IA-37 — signer-token lifecycle. Appended at the table end (D1 can't add a
    // column mid-table on a referenced table — reference_d1_add_column_at_end).
    // NULL expiresAt = never expires (legacy / synthesized signers); revokedAt
    // set = link killed regardless of expiry. Resolution fails closed on either.
    expiresAt:          integer('expires_at', { mode: 'timestamp_ms' }),
    revokedAt:          integer('revoked_at', { mode: 'timestamp_ms' }),
    // Which version of the platform language DISCLOSURE this signer was shown.
    // Not a contractual term (review, 2026-08-02) — but still the only way to
    // answer "what was this person actually shown", which is the question a
    // dispute turns on.
    //
    // NULLABLE and meant to stay that way. NULL means "the platform did not
    // render the disclosure to this signer, or cannot vouch that it did" —
    // signatures collected before this shipped, and the on-site
    // `POST /api/inspections/:id/sign` surface, where the API returns the
    // agreement text and the CALLER draws the screen. Writing a version for
    // either would be a false statement about what they saw. Only a surface the
    // platform renders may state a number here.
    //
    // Appended at the table end (see the expiresAt/revokedAt note above).
    languageDisclosureVersion: integer('language_disclosure_version'),
    // ── Attribution provenance (review review, 2026-08-15) ───────────────
    //
    // How this row came to say that THIS person's signature is THIS image. A
    // record produced by a migration is not the same fact as one captured at
    // signing, and review rule is that the two must stay distinguishable —
    // so that nobody reading `signature -> Alice` years from now mistakes an
    // attribution we derived for an identity the signing event recorded.
    //
    //   signing_event                 the signer signed here; `markSignedBySigner`
    //                                 wrote the image and the identity together.
    //   relocated_single_signer       the signature came off the envelope, and
    //                                 this was the envelope's ONLY signer row.
    //   relocated_envelope_recipient  the envelope had NO signer rows; this row
    //                                 was created for it, and the identity comes
    //                                 from the envelope's recipient fields.
    //
    // NULL on rows that predate the field and on rows carrying no signature —
    // there is no attribution to describe. NOT a `{ enum }` on purpose: a value
    // this column has already written must stay readable after the code that
    // wrote it is gone, and a narrowing enum would make an old basis a type
    // error rather than a fact.
    attributionBasis:  text('attribution_basis'),
    // For a relocated row, WHERE the attribution came from, in durable terms
    // (table + column names, which survive renumbering). NULL when the basis is
    // `signing_event` — nothing was derived, so there is no source to cite.
    attributionSource: text('attribution_source'),
    // When the attribution was made: the signing time for a captured one, the
    // migration's run time for a relocated one. Distinct from `signedAt`, which
    // is when the person signed — for a relocated row those differ by years.
    attributedAt:      integer('attributed_at', { mode: 'timestamp_ms' }),
}, (t) => [
    index('idx_agreement_signers_tenant_request').on(t.tenantId, t.requestId),
    uniqueIndex('idx_agreement_signers_request_email').on(t.requestId, t.email),
    uniqueIndex('idx_agreement_signers_token_hash').on(t.tokenHash),
]);
