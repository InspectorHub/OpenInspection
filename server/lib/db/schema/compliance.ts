import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

/**
 * Track I-a GDPR (spec §4) — append-only DSAR (data-subject erasure) decision
 * record. Required by GDPR Art. 5(2) + Art. 30 (accountability: you must be
 * able to prove you honored an erasure request). Deliberately a PLATFORM-LEVEL
 * table with NO foreign key to `tenants` (matches `tenant_destruction_records`
 * / `audit_logs` posture for records that must survive their subject rows).
 *
 * Itself stores `subject_email` (that IS PII), but it is the legally-required
 * accountability record and is exempt from erasure — you cannot prove you
 * honored a request if you delete the record of it. Documented as a
 * retain-by-obligation row; a future Cron sweep MAY hash subject_email past a
 * long window (out of scope v1).
 *
 * `decisions_json` is a serialized array of
 *   [{ table, action: delete|null|hash|retain|anonymize, count, legalBasis?, retentionExpiry? }].
 */
export const erasureLog = sqliteTable('erasure_log', {
    id:              text('id').primaryKey(),
    tenantId:        text('tenant_id').notNull(),
    // The data subject (client) whose erasure was requested.
    subjectEmail:    text('subject_email').notNull(),
    // The admin/user sub who ran the erasure (accountability). Nullable for
    // system-initiated runs.
    requestedBy:     text('requested_by'),
    // How the subject's identity was verified — free text or 'admin_action'.
    identityBasis:   text('identity_basis'),
    status:          text('status', { enum: ['completed', 'partially_completed', 'refused'] }).notNull(),
    // Serialized decision array (see file docblock).
    decisionsJson:   text('decisions_json').notNull(),
    // Rows kept under an exemption (signed evidence retained).
    retainedCount:   integer('retained_count').notNull().default(0),
    anonymizedCount: integer('anonymized_count').notNull().default(0),
    deletedCount:    integer('deleted_count').notNull().default(0),
    // What we told the subject (refusal reasons / summary).
    responseNote:    text('response_note'),
    // Unix ms.
    createdAt:       integer('created_at').notNull(),
}, (t) => [
    index('idx_erasure_log_tenant').on(t.tenantId, t.createdAt),
]);

// Track L (D7) — the TCPA disclosure shown at SMS opt-in. version is monotonic;
// the current (max) version is shown to clients and stamped on each consent event.
export const smsDisclosureVersions = sqliteTable('sms_disclosure_versions', {
    version:     integer('version').primaryKey(),
    text:        text('text').notNull(),
    publishedAt: integer('published_at', { mode: 'timestamp_ms' }).notNull(),
});

// Track L (D7) — append-only SMS consent ledger (mirrors erasure_log). Current
// consent state = latest event per (tenant_id, contact_id). Never updated/deleted.
export const smsConsentLog = sqliteTable('sms_consent_log', {
    id:                text('id').primaryKey(),
    tenantId:          text('tenant_id').notNull(),
    contactId:         text('contact_id').notNull(),   // the consumer (client) contact
    recipientType:     text('recipient_type', { enum: ['client'] }).notNull(),
    action:            text('action', { enum: ['granted', 'revoked'] }).notNull(),
    disclosureVersion: integer('disclosure_version').notNull(),
    capturedVia:       text('captured_via', { enum: ['booking_form', 'optin_link', 'admin'] }).notNull(),
    ip:                text('ip'),
    userAgent:         text('user_agent'),
    createdAt:         integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    index('idx_sms_consent_contact').on(t.tenantId, t.contactId, t.createdAt),
]);

// SMS provider compliance state — one row per tenant, tracks Twilio (or
// future provider) TCR registration progress through the managed-pool flow.
// `mode` mirrors the tenant's sms_mode but only records managed/own tenants
// (platform passthrough has no per-tenant compliance entities to track).
// `provider` records which carrier the SIDs belong to.
// All SID/status columns are nullable: filled in progressively as each
// registration step completes (see #181 compliance orchestration).
// `complianceStatus` is the rolled-up gate: 'approved' = fully cleared to send.
export const messagingCompliance = sqliteTable('messaging_compliance', {
    tenantId: text('tenant_id').notNull().primaryKey(),
    mode: text('mode', { enum: ['own', 'managed_shared', 'managed_dedicated'] }).notNull().default('own'),
    provider: text('provider', { enum: ['twilio', 'telnyx'] }), // which provider holds this tenant's entities
    subaccountSid: text('subaccount_sid'),
    customerProfileSid: text('customer_profile_sid'),
    customerProfileStatus: text('customer_profile_status'),
    brandSid: text('brand_sid'),
    brandStatus: text('brand_status'),
    campaignSid: text('campaign_sid'),
    campaignStatus: text('campaign_status'),
    tfvSid: text('tfv_sid'),
    tfvStatus: text('tfv_status'),
    messagingServiceSid: text('messaging_service_sid'),
    provisionedNumber: text('provisioned_number'),
    complianceStatus: text('compliance_status', {
        enum: ['not_started', 'profile_pending', 'brand_pending', 'campaign_pending', 'tfv_pending', 'approved', 'rejected'],
    }).notNull().default('not_started'),
    rejectionReason: text('rejection_reason'),
    lastSyncAt: integer('last_sync_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});
