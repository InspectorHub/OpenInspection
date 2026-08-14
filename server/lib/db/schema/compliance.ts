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
    createdAt:       integer('created_at', { mode: 'timestamp_ms' }).notNull(),
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
//
// Communication A3.2 — `recipient_type` widened from `['client']` to mirror
// RoleKind so non-client rows can be stamped honestly. Consent BASIS per kind
// (express vs implied) lives in `server/lib/sms/consent-basis.ts` (D5):
//   client → express (TCPA recorded grant required)
//   agent  → implied (B2B phone-on-file)
//   other  → implied (Attorney / TC / Insurance / Title — business counterparties)
// Capture paths today still only write consumer (`client`) rows; the enum is
// the vocabulary the gate and any future capture path share.
export const smsConsentLog = sqliteTable('sms_consent_log', {
    id:                text('id').primaryKey(),
    tenantId:          text('tenant_id').notNull(),
    /**
     * The contact this consent attaches to — NULL when the subject is a staff
     * `users` row (see `subjectKind` below). Kept alongside the subject pair
     * rather than retired because `idx_sms_consent_contact` and every existing
     * reader use it, and a consent ledger is the wrong place to do a rename.
     */
    contactId:         text('contact_id'),
    /**
     * The BASIS the recipient was reachable under, for a carrier audit.
     *
     * `staff` is internal-operational: an employee under account/employment
     * terms, never consumer consent. It is a separate value precisely so a
     * staff STOP can be recorded without polluting the consumer evidence the
     * ISV filing rests on — see docs/superpowers/specs/2026-07-30-sms-consent-isv-strategy.md.
     */
    recipientType:     text('recipient_type', { enum: ['client', 'agent', 'other', 'staff'] }).notNull(),
    // The consent VERDICT. The latest row per subject is the whole answer the
    // send gate reads (`sms/send-gate.ts`, `notifications/channel-consent.ts`):
    // one 'revoked' blocks every later SMS until a new 'granted' is appended.
    action:            text('action', { enum: ['granted', 'revoked'] }).notNull(),
    disclosureVersion: integer('disclosure_version').notNull(),
    // `settings_page` is a grant made inline on the notifications screen, with
    // the disclosure rendered there. Type-layer only — the DDL is plain text,
    // so widening this costs no migration.
    capturedVia:       text('captured_via', { enum: ['booking_form', 'optin_link', 'admin', 'settings_page'] }).notNull(),
    // Request evidence for the grant, taken from CF-Connecting-IP / User-Agent
    // at the capture site (the booking form is the only path that supplies
    // them today) — NULL wherever there is no browser request, e.g. an inbound
    // STOP or an admin-recorded event. Both are declared `retain` under
    // art_17_3_b in ERASURE_MANIFEST: a DSAR erasure deliberately leaves them,
    // because they are the proof the consent happened.
    ip:                text('ip'),
    userAgent:         text('user_agent'),   // captured with `ip`; retained through erasure on the same basis
    createdAt:         integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    /**
     * WHO the consent is about, generalised beyond `contacts`.
     *
     * Staff are `users` rows and have no contact, so a ledger keyed only on
     * `contact_id` could not record their STOP at all. Mirrors the
     * `notification_preferences` subject pair deliberately: one shape for "a
     * person, of either kind", rather than a second XOR of nullable columns.
     *
     * Appended at the END — a column inserted mid-table makes drizzle-kit
     * rebuild the whole thing, and this one holds legal evidence.
     */
    subjectKind:       text('subject_kind', { enum: ['contact', 'user'] }).notNull().default('contact'),
    subjectId:         text('subject_id').notNull().default(''),
}, (t) => [
    index('idx_sms_consent_contact').on(t.tenantId, t.contactId, t.createdAt),
    index('idx_sms_consent_subject').on(t.tenantId, t.subjectKind, t.subjectId, t.createdAt),
]);

// SMS provider compliance state — one row per tenant, tracks carrier (Twilio /
// Telnyx) registration progress through the managed-pool flow.
// `provider` records which carrier the SIDs belong to.
// Every SID/status column below is nullable and written by ONE step of the
// provisioning chain (`lib/messaging/providers/*.ts`, driven through
// `D1ComplianceStateStore`), which is what makes a crashed run resumable: each
// step is skipped when its SID is already present. A NULL therefore says the
// flow never reached that step. Status columns hold the carrier's RAW string,
// not our enum, and are refreshed by the compliance webhook + cron sweep.
export const messagingCompliance = sqliteTable('messaging_compliance', {
    tenantId: text('tenant_id').notNull().primaryKey(),
    // Which flow this row belongs to — NOT the tenant's send mode, which lives
    // on `tenant_configs.sms_mode`. Only two values are ever written: the state
    // store stamps 'managed_dedicated' when provisioning starts, syncOwnStatus
    // stamps 'own'. The cron sweep selects on it, so an 'own' row is never
    // polled against (and overwritten from) the platform ISV account.
    mode: text('mode', { enum: ['own', 'managed_shared', 'managed_dedicated'] }).notNull().default('own'),
    provider: text('provider', { enum: ['twilio', 'telnyx'] }), // which provider holds this tenant's entities
    // `subaccount_sid` was here. Unlike its neighbours it was never written by
    // any provisioning step and never read by any resolver — the one column of
    // this table with no code on either side of it.
    // Step 1 of both Twilio channels: the TrustHub CustomerProfile, created with
    // the tenant's legal name and the per-tenant compliance webhook URL (which
    // is registered ONLY on this call, so a resume never re-registers it).
    // Always NULL on a Telnyx row — that flow opens at the brand instead.
    customerProfileSid: text('customer_profile_sid'),
    customerProfileStatus: text('customer_profile_status'),  // step-1 verdict for the SID above
    // The 10DLC brand registration (Twilio step 2, Telnyx step 1). Approval here
    // is NOT tenant approval: the campaign is the terminal entity, and both the
    // webhook and the poll are explicitly guarded so a late brand-approved
    // callback cannot roll a campaign_pending/approved row backwards.
    brandSid: text('brand_sid'),
    brandStatus: text('brand_status'),      // 10DLC brand verdict; approval here is not tenant approval
    // The 10DLC campaign — terminal entity for the sp10dlc channel, so its
    // approval is what sets complianceStatus='approved'. Twilio exposes no REST
    // read for the status (webhook only); Telnyx does poll it in syncStatus.
    campaignSid: text('campaign_sid'),
    campaignStatus: text('campaign_status'),  // 10DLC campaign verdict; Twilio learns it by webhook only
    // Toll-free verification — terminal entity for the tollfree channel; NULL on
    // every sp10dlc row. `tfvSid` is the id the status read keys on, which on
    // Telnyx is the create response's `id`, not its verificationRequestId.
    tfvSid: text('tfv_sid'),
    tfvStatus: text('tfv_status'),          // toll-free verification verdict; NULL on the sp10dlc path
    // The sending container the provisioned number is attached to (Twilio
    // Messaging Service SID / Telnyx messaging-profile id). Also read at SEND
    // time: `resolve-twilio.buildManagedBag` uses it for managed_dedicated
    // tenants, and NULL there means no managed credential bag is built at all.
    messagingResourceSid: text('messaging_resource_sid'),
    // Provider-specific metadata stored as a JSON string. Used by non-Twilio
    // providers (e.g. Telnyx) to persist vetting or compliance entity IDs that
    // do not map to the Twilio-shaped SID columns above. Nullable: absent for
    // Twilio tenants and for rows that pre-date multi-provider support.
    providerMeta: text('provider_meta'),
    // The purchased DID in E.164, persisted together with its SID before the
    // attach step. Displayed to the tenant by the Settings compliance wizard,
    // and it is the VALUE (not the SID) that Telnyx's campaign assignment and
    // toll-free submission take.
    provisionedNumber: text('provisioned_number'),
    // The Twilio phone-number SID (PN...) returned by numbers.buy. Required for
    // attachSender and tollfree.create; persisted before those calls so a crash-
    // resumed run can reuse the already-purchased number instead of buying again.
    provisionedNumberSid: text('provisioned_number_sid'),
    // True once the provisioned number is attached to the messaging service. The
    // buy step persists provisionedNumberSid BEFORE attachSender, so this separate
    // marker lets a crash-resumed run re-run only the attach (without re-buying) —
    // attachSender is not assumed idempotent, so it is guarded on its own flag.
    senderAttached: integer('has_sender_attached', { mode: 'boolean' }).notNull().default(false),
    // The rolled-up gate, and a live authorization: `managedSendAllowed` blocks
    // EVERY managed_dedicated send unless this reads 'approved' (a missing row
    // blocks too — fail closed). Provisioning only ever advances it to a
    // *_pending value; 'approved' comes exclusively from the carrier webhook or
    // the cron sweep, and neither is allowed to move it backwards.
    complianceStatus: text('compliance_status', {
        enum: ['not_started', 'profile_pending', 'brand_pending', 'campaign_pending', 'tfv_pending', 'approved', 'rejected'],
    }).notNull().default('not_started'),
    // The carrier's own words for the latest rejection ("code=…: message"),
    // stored verbatim because the tenant has to act on it — the wizard shows it
    // under the rejected state. Cleared back to NULL when a terminal entity is
    // approved. NULL while nothing has been rejected.
    rejectionReason: text('rejection_reason'),
    lastSyncAt: integer('last_sync_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});
