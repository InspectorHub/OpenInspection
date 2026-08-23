/**
 * Track I-a GDPR (spec §5) — the erasure manifest's out-of-scope register.
 *
 * The companion to `ERASURE_MANIFEST` in `erasure-manifest.ts`: the columns the
 * PII heuristic flags that erasure deliberately does NOT act on, each with the
 * reason. Split out of the manifest when that file reached its anti-monolith
 * line cap — the two arrays are read together and mean nothing apart, so the
 * gate concatenates both sources before parsing either. Add a column here only
 * with a reason that says why it cannot carry a data subject's data; an entry
 * without one is a shrug that reads like a decision.
 */

/**
 * A PII-heuristic column the manifest DELIBERATELY does not act on. Every entry
 * must say why — the reason is what a DSAR audit reads, and the CI gate
 * (`scripts/check-erasure-manifest.mjs`) hard-fails an entry without one.
 *
 * @gateConsumed `scripts/check-erasure-manifest.mjs` reads this declaration out
 * of the SOURCE TEXT (`arrayBody(src, 'ERASURE_OUT_OF_SCOPE')`) rather than
 * importing it — the gate is a plain .mjs script and the manifest is TypeScript.
 * That consumption is invisible to a module-graph analyzer, so knip would report
 * both symbols as dead. The tag (knip `tags: ["-gateConsumed"]`) says "a tool
 * consumes this", which is true; a dead-code baseline entry would have said
 * "this is dead and we tolerate it", which is not.
 */
export interface ErasureOutOfScopeEntry {
    table: string;
    column: string;
    reason: string;
}

/** @gateConsumed read as source text by `scripts/check-erasure-manifest.mjs`. */
export const ERASURE_OUT_OF_SCOPE: ErasureOutOfScopeEntry[] = [
    // Columns that ride with a row-delete rule above (per-column scan cannot
    // see row semantics).
    { table: 'contacts',            column: 'phone',        reason: 'rides with the contacts row delete (locator = email)' },
    // The rest of the CRM row. `phone` sat here alone for as long as the rule
    // existed, which read as a claim that phone was the only other personal
    // column on the table — it is not, and `name` is NOT NULL. The row is
    // deleted whole, so the answer for all of them is the same; the reason it is
    // written out per column is that a register listing one sibling and not the
    // others is the shape a reader trusts and should not.
    { table: 'contacts',            column: 'name',         reason: 'rides with the contacts row delete (locator = email); NOT NULL, which is why the rule deletes the row rather than nulling in place' },
    { table: 'contacts',            column: 'agency',       reason: 'the agent brokerage this contact works for — rides with the contacts row delete (locator = email)' },
    { table: 'contacts',            column: 'notes',        reason: 'free text staff write about this contact — rides with the contacts row delete (locator = email)' },
    { table: 'contacts',            column: 'locale',       reason: 'the language this contact asked to be addressed in, a stated preference of the data subject — rides with the contacts row delete (locator = email)' },
    { table: 'contacts',            column: 'type',         reason: 'client/agent/other classification OF the data subject — rides with the contacts row delete (locator = email)' },
    { table: 'contacts',            column: 'agent_user_id', reason: 'binding to the global agent account this contact is — rides with the contacts row delete (locator = email)' },

    // ── report_views (#271) ───────────────────────────────────────────────────
    // Every column here is behavioural data about an identified recipient, and
    // the PII heuristic matches none of them. They are excused only because the
    // `access_token_id` rule above deletes the whole ROW; without that rule this
    // block would be four unanswered questions rather than four references.
    { table: 'report_views', column: 'first_viewed_at', reason: 'when this recipient first opened the report — rides with the report_views row delete (locator = access_token_id)' },
    { table: 'report_views', column: 'last_viewed_at',  reason: 'when this recipient last opened the report — rides with the report_views row delete (locator = access_token_id)' },
    { table: 'report_views', column: 'view_count',      reason: 'how many times this recipient opened the report — rides with the report_views row delete (locator = access_token_id)' },
    { table: 'report_views', column: 'inspection_id',   reason: 'which order was opened; meaningful only paired with the recipient, and rides with the report_views row delete' },
    // The Art. 21 objection marker. It records that this recipient exercised a
    // right and on what date, so it is the subject data — but it lives on the
    // token row the manifest already deletes by `recipient_email`, and an
    // objection cannot outlive the access it objects to being measured on.
    { table: 'inspection_access_tokens', column: 'view_tracking_objected_at', reason: 'records that this recipient objected to view measurement, and when — rides with the inspection_access_tokens row delete (locator = recipient_email)' },

    // Staff, not data subjects. Consumer-DSAR erasure never touches employee
    // accounts; staff offboarding is a separate lifecycle.
    { table: 'users',               column: 'email',                     reason: 'staff account — not consumer-DSAR scope' },
    { table: 'users',               column: 'phone',                     reason: 'staff account — not consumer-DSAR scope' },
    // 'staff signature asset' said WHOSE it is and stopped
    // there, which left the column indefinite by omission rather than by
    // decision — and a staff signature may not inherit
    // 'indefinite' from the client column having a six-year rule. Two different
    // clocks, and they must say so:
    //   - This one is an ACCOUNT ASSET. It is the inspector's saved default
    //     drawing, reused across every future countersignature, so its purpose
    //     lasts exactly as long as the account. It expires with the account
    //     (tenant purge, or staff offboarding), not on an envelope's window.
    //   - `agreement_requests.inspector_signature_base64` below is a
    //     COUNTERSIGNATURE ON ONE ENVELOPE, so it expires with that envelope.
    { table: 'users',               column: 'default_signature_base64',  reason: 'inspector (staff) signature asset — purpose: reusable account asset for countersigning; basis: contract performance with the tenant; window: life of the account (destroyed by the tenant purge / staff offboarding), NOT the agreement window — see docs/compliance/retention-policy.md' },
    { table: 'users',               column: 'is_signature_enabled',      reason: 'boolean flag, not personal data' },
    // An inspector's routing origin can be their home address, so it IS personal
    // data — it is simply not a CONSUMER data subject's. Same posture as
    // users.email/phone above: consumer-DSAR erasure never touches it and there
    // is deliberately no DSAR-export path for it. Declared here so the decision
    // is recorded rather than inferred from the PII heuristic not matching
    // 'service_origin_address'.
    { table: 'users',               column: 'service_origin_address',    reason: 'staff routing origin (may be a home address) — staff offboarding lifecycle, not consumer-DSAR scope' },
    { table: 'users',               column: 'service_origin_lat',        reason: 'staff routing origin coordinate — not consumer-DSAR scope' },
    { table: 'users',               column: 'service_origin_lng',        reason: 'staff routing origin coordinate — not consumer-DSAR scope' },
    { table: 'tenant_invites',      column: 'email',                     reason: 'staff invite — not consumer-DSAR scope' },
    { table: 'audit_logs',          column: 'ip_address',                reason: 'staff-action security audit trail' },
    { table: 'report_signoff',      column: 'signature_ref',             reason: 'inspector (staff) signoff reference' },
    { table: 'agreement_requests',  column: 'inspector_signature_base64', reason: 'inspector (staff) countersignature — purpose: evidence that the company executed THIS agreement; basis: Art. 17(3)(e) defence of legal claims, the same basis as the client signature it sits opposite; window: the tenant agreement retention window, destroyed by the same envelope-expiry pass (retention-sweep.ts) that nulls the client signature and its three R2 artefacts' },
    // Provenance ABOUT the signature evidence, not evidence itself: which rule
    // attributed a signature to a person, what that rule read, and when it ran.
    // Declared rather than left to the heuristic because they sit on the table
    // holding Art. 17(3)(e) retained evidence, where a future reader is entitled
    // to see that every column was ruled on.
    { table: 'agreement_signers',   column: 'attribution_basis',         reason: 'provenance metadata — names a rule, carries no personal data' },
    { table: 'agreement_signers',   column: 'attribution_source',        reason: 'provenance metadata — names source COLUMNS, never their values' },
    { table: 'agreement_signers',   column: 'attributed_at',             reason: 'provenance metadata — when the attribution was made, not a subject event' },
    // The staff identity columns the heuristic never asked about. Each one sits
    // beside a column that WAS declared, which is the tell: `users.email` and
    // `users.phone` were ruled on while `users.name` was not, and
    // `report_signoff.signature_ref` was ruled on while the signer NAME and
    // LICENCE NUMBER on the same row were not. The answer is the same for all of
    // them and always was; nobody had been asked, because the pattern only
    // matched the neighbours.
    { table: 'users',               column: 'name',                      reason: 'staff account — not consumer-DSAR scope; the sibling of users.email above, which the PII pattern happened to match' },
    { table: 'users',               column: 'photo_url',                 reason: 'staff profile photo shown on reports — not consumer-DSAR scope' },
    { table: 'users',               column: 'slug',                      reason: 'inspector public URL slug, derived from the staff name — not consumer-DSAR scope' },
    { table: 'users',               column: 'password_hash',             reason: 'staff authentication credential; destroyed by account deletion, never by a consumer erasure request' },
    { table: 'users',               column: 'totp_secret',               reason: 'staff second-factor seed — authentication credential, not consumer-DSAR scope' },
    { table: 'users',               column: 'totp_recovery_codes',       reason: 'staff second-factor recovery codes — authentication credential, not consumer-DSAR scope' },
    { table: 'users',               column: 'last_active_at',            reason: 'staff activity timestamp used for seat accounting — not consumer-DSAR scope' },
    { table: 'report_signoff',      column: 'name',                      reason: 'the STAFF signer name on a professional attestation; the signature it attests is retained, so the identity of who signed cannot be removed without voiding it. Not consumer-DSAR scope' },
    { table: 'report_signoff',      column: 'license',                   reason: 'the staff signer professional licence number as printed in the Appendix D qualifications — part of the attestation, not consumer-DSAR scope' },
    { table: 'report_signoff',      column: 'person_id',                 reason: 'staff identity sub of the signer (accountability) — not consumer-DSAR scope' },
    { table: 'report_signoff',      column: 'qualifications_ref',        reason: 'pointer to the staff qualifications exhibit — not consumer-DSAR scope' },
    { table: 'inspector_credentials', column: 'member_number',           reason: 'staff association membership or licence number displayed on reports — not consumer-DSAR scope' },
    { table: 'inspector_credentials', column: 'label',                   reason: 'staff credential label (the issuing body) — not consumer-DSAR scope' },
    { table: 'inspector_credentials', column: 'image_r2_key',            reason: 'staff credential badge image — not consumer-DSAR scope' },
    { table: 'calendar_blocks',     column: 'title',                     reason: 'staff personal calendar block title — not consumer-DSAR scope' },
    { table: 'calendar_blocks',     column: 'notes',                     reason: 'free text a staff member writes on their own calendar block — not consumer-DSAR scope' },
    // A Google/Microsoft calendar id is normally the staff account ADDRESS, so
    // this is an email column whose name says nothing of the kind.
    { table: 'calendar_connections', column: 'calendar_id',              reason: 'the connected calendar identifier, which for Google and Microsoft is the staff account email address — staff offboarding lifecycle, not consumer-DSAR scope' },
    { table: 'calendar_connections', column: 'credentials_enc',          reason: 'encrypted staff OAuth tokens for their own calendar account — revoked at offboarding, not by a consumer erasure request' },
    { table: 'calendar_connection_read_calendars', column: 'external_calendar_id', reason: 'a secondary calendar id on the staff connection, again usually an account address — not consumer-DSAR scope' },
    { table: 'calendar_connection_read_calendars', column: 'summary',    reason: 'display name of the staff calendar as the provider reports it — not consumer-DSAR scope' },
    { table: 'integration_test_results', column: 'tested_by_user_id',    reason: 'staff user who ran the Test connection probe — not consumer-DSAR scope' },
    { table: 'tenant_marketplace_import_history', column: 'created_by',  reason: 'staff user who performed the template import — not consumer-DSAR scope' },
    // The core->portal user-sync outbox. The heuristic flags neither column, and
    // `payload` is the heaviest staff-PII blob in the schema: a serialized
    // CloudEvent carrying email, name and — for user.password_changed — the
    // password HASH. Declared here for the DSAR question; the separate storage
    // question it also raises is answered by the sync_outbox rule in
    // RETENTION_MANIFEST, which now expires terminal rows at 60 days.
    { table: 'sync_outbox',         column: 'payload',                   reason: 'serialized user-sync CloudEvent about a STAFF account (email, name, and for user.password_changed the password hash) — staff offboarding lifecycle, not consumer-DSAR scope. Bounded separately by the sync_outbox retention rule' },
    { table: 'erasure_log',         column: 'requested_by',              reason: 'the staff admin sub who RAN the erasure, recorded for accountability — the operator, not the data subject' },
    { table: 'erasure_log',         column: 'decisions_json',            reason: 'the per-table decision array (table name, action, count, legal basis, expiry) written by the orchestrator — counts and identifiers of TABLES, never a row value or a subject identifier' },

    // The controller's own business identity, not a data subject's.
    { table: 'tenant_configs',      column: 'support_email',    reason: 'company-owned support address' },
    { table: 'tenant_configs',      column: 'sender_email',     reason: 'company-owned sending address' },
    { table: 'tenant_configs',      column: 'company_phone',    reason: 'company-owned phone' },
    { table: 'tenant_configs',      column: 'company_lat',      reason: 'company office coordinate — controller business identity' },
    { table: 'tenant_configs',      column: 'company_lng',      reason: 'company office coordinate — controller business identity' },
    // The address family's other half. `company_address` is a business's own
    // published location — the controller's identity, not a data subject's —
    // so it follows its `company_lat`/`company_lng` siblings above and NOT the
    // `inspections` rules, where the address is somebody's home. The two look
    // alike to a name-matching gate and are not the same question.
    { table: 'tenant_configs',      column: 'company_address',  reason: 'company office address — controller business identity, published on reports and invoices' },
    // `reply_to` is an EMAIL ADDRESS column whose name contains neither "email"
    // nor "mail", so the pattern that caught `sender_email` and `support_email`
    // two lines up walked straight past it. Same answer, and it had to be asked
    // for separately.
    { table: 'tenant_configs',      column: 'reply_to',         reason: 'the Reply-To header address on the tenant outbound mail — company-owned, the sibling of sender_email above' },
    { table: 'tenant_configs',      column: 'sender_display_name', reason: 'the From display name on tenant outbound mail — the company sending identity as published to recipients' },
    { table: 'tenant_configs',      column: 'privacy_body',     reason: 'the tenant own hosted Privacy policy text — company-authored prose, the same answer as tenant_legal_versions.body_snapshot below' },
    { table: 'tenant_configs',      column: 'terms_body',       reason: 'the tenant own hosted Terms text — company-authored prose, the same answer as tenant_legal_versions.body_snapshot below' },
    { table: 'tenant_configs',      column: 'ics_token',        reason: 'opaque bearer token for the company calendar feed — a credential, not an identifier of any person' },
    { table: 'messaging_compliance', column: 'provisioned_number', reason: 'the E.164 number provisioned TO the tenant for outbound SMS — the company sending identity, never a recipient number' },
    { table: 'qbo_connections',     column: 'company_name',     reason: 'the tenant own QuickBooks company name as Intuit reports it — controller business identity' },
    // Reads like PII, is not. Checked in source rather than inferred from the
    // name, because both of these would otherwise be waved through in the
    // opposite direction — declared as personal data that does not exist.
    { table: 'tenant_configs',      column: 'point_of_contact', reason: 'a two-value enum (inspector or company) choosing WHOSE identity client mail comes from — a setting, not a person. The name reads like a contact record and holds no name' },
    { table: 'tenant_configs',      column: 'ai_key_attestation_account_owner', reason: 'a single-value enum (tenant) recording who owns the AI provider account — an attestation answer, not an account holder name' },
    { table: 'tenant_configs',      column: 'repair_quick_phrases', reason: 'a tenant-maintained list of quick-insert phrases for repair notes (JSON string array) — reusable template text authored by the company, never composed about a client' },

    // Heuristic false positives — config values and references, not PII.
    { table: 'tenant_configs',        column: 'email_mode',               reason: 'config enum, not personal data' },
    { table: 'tenant_configs',        column: 'email_byo_provider',       reason: 'config enum, not personal data' },
    { table: 'automations',           column: 'recipient_kind',           reason: 'config enum, not personal data' },
    { table: 'automations',           column: 'recipient_role_profile_id', reason: 'role-profile reference, not personal data' },
    { table: 'automations',           column: 'email_template_id',        reason: 'template reference, not personal data' },
    { table: 'automation_logs',       column: 'recipient_role_key',       reason: 'role key, not personal data' },
    { table: 'automation_logs',       column: 'recipient_contact_id',     reason: 'opaque id on the retained evidence ledger (see the automation_logs.recipient retain rule)' },
    { table: 'contact_role_profiles', column: 'email_template_id',        reason: 'template reference, not personal data' },
    { table: 'sms_consent_log',       column: 'recipient_type',           reason: 'role-kind enum, not personal data' },
    // The subject POINTERS on the consent ledger. Same answer and same shape as
    // automation_logs.recipient_contact_id two lines up: the ledger itself is
    // retained under Art. 17(3)(b) (see the sms_consent_log.ip retain rule), and
    // the record is worthless as consent evidence if it cannot say whose consent
    // it was. Declared because the heuristic flags neither.
    { table: 'sms_consent_log',       column: 'contact_id',               reason: 'opaque id naming whose consent this is, on the retained TCPA evidence ledger (see the sms_consent_log.ip retain rule)' },
    { table: 'sms_consent_log',       column: 'subject_id',               reason: 'opaque id of the contact or staff user the consent attaches to, on the retained TCPA evidence ledger' },
    { table: 'report_versions',       column: 'signature',                reason: 'report-content integrity seal, not personal data' },
    // ── reports ───────────────────────────────────────────────────────────────
    // A report is findings about a named person's property. `title` is the only
    // non-id column, and it is system-written — a literal or a snapshot of a
    // tenant catalogue service name — so it has its own `erase_in_place` rule
    // rather than an entry here. The rest of the row is ids, enums and a stamp,
    // declared out of scope below.
    //
    // (Corrected 2026-08-07 — this said `title` is "free text a human writes"
    // that "routinely carries the address". False in both halves; the rule did
    // not change. Amendment history is in `erasure-manifest.ts`.)
    { table: 'reports',               column: 'inspection_id',            reason: 'opaque id; the inspection row carries its own rules' },
    { table: 'reports',               column: 'tenant_id',                reason: 'tenant scope key, not personal data' },
    { table: 'reports',               column: 'id',                       reason: 'opaque primary key' },
    { table: 'reports',               column: 'kind',                     reason: 'primary/ancillary enum, not personal data' },
    { table: 'reports',               column: 'inspection_service_id',    reason: 'billing-line reference, not personal data' },
    { table: 'reports',               column: 'template_id',              reason: 'template reference, not personal data' },
    { table: 'reports',               column: 'status',                   reason: 'workflow enum, not personal data' },
    { table: 'reports',               column: 'created_at',               reason: 'record timestamp, not personal data' },
    { table: 'reports',               column: 'published_at',             reason: 'record timestamp, not personal data' },
    { table: 'reports',               column: 'notified_at',              reason: 'record timestamp, not personal data' },
    { table: 'reports',               column: 'sort_order',               reason: 'presentation ordering integer, not personal data' },
    // The tenant's own published Privacy / Terms. `body_snapshot` is the
    // company's prose, not a data subject's data, and the row's whole purpose is
    // to be immutable — erasing it would destroy the record of what a document
    // said at a date, which is the one thing it exists to answer. Listed rather
    // than left silent because the PII heuristic does not flag any column here,
    // and silence is not the same as a decision.
    // The payment ledger. The `note` column has its own in-place erase rule;
    // everything that carries a figure or an actor reference is declared here
    // rather than left silent, because the heuristic flags none of it and
    // silence is not the same as a decision.
    { table: 'order_payments',        column: 'amount_cents',
      reason: 'financial record retained under accounting/tax obligation; carries no subject identifier on its own' },
    { table: 'order_payments',        column: 'recorded_by',
      reason: 'staff user id (who keyed the payment) — not consumer-DSAR scope' },
    { table: 'order_payments',        column: 'provider_ref',
      reason: 'payment-processor reference on the retained financial row, not personal data' },
    { table: 'tenant_legal_versions', column: 'body_snapshot',            reason: 'company-authored policy text, not personal data of any data subject' },
    { table: 'tenant_legal_versions', column: 'published_by_user_id',     reason: 'staff author reference — not consumer-DSAR scope' },

    // ── account_acceptances ───────────────────────────────────────────────────
    // What a STAFF member accepted, recorded in the same write as the `users`
    // row it belongs to — one write, never two. The subject is an
    // owner, admin or invited member of the workspace — an employee lifecycle,
    // the same posture as every `users.*` entry above — so a consumer erasure
    // request never reaches this table at all.
    //
    // ⚠️ NOTHING WENT RED TO PRODUCE THIS BLOCK, and that is the reason it is
    // written out column by column. `PII_HEURISTIC` in
    // `scripts/check-erasure-manifest.mjs` matches NO column here: not
    // `actor_identity_ref`, not `content_hash`, not `authority_basis`. The whole
    // table could have shipped with `lint:erasure` green, which is precisely the
    // failure `docs/compliance/erasure-heuristic-limits.md` describes — silence
    // reading as coverage. Two of these keys are pinned in the coverage spec's
    // HEURISTIC_BLIND_SPOTS so the declaration is enforced rather than merely
    // present.
    //
    // The second reason this is not a deletion, beyond the staff/consumer line:
    // the row is the evidence that the account was VALIDLY CREATED. Erasing it
    // does not shrink a record of a person, it destroys the proof that the
    // person consented — leaving an account standing with no acceptance behind
    // it, which is the exact state the table exists to make unreachable.
    { table: 'account_acceptances', column: 'user_id',
      reason: 'the staff `users` row this acceptance was committed alongside — staff lifecycle, not consumer-DSAR scope; deleting it would leave an account standing with no acceptance, the state the table exists to prevent' },
    { table: 'account_acceptances', column: 'actor_identity_ref',
      reason: 'the portal `identities.id` the acceptance was captured against, when it was captured there — an opaque staff-account reference, not consumer data; NULL for an acceptance captured on this side' },
    { table: 'account_acceptances', column: 'doc',
      reason: 'which document was accepted (a document name, e.g. `terms`) — not personal data' },
    { table: 'account_acceptances', column: 'version',
      reason: 'the version string of the document the person was shown — not personal data' },
    { table: 'account_acceptances', column: 'content_hash',
      reason: 'SHA-256 of the body shown, which is what makes the acceptance checkable; a hash of company-authored policy text, not of anything about the person' },
    { table: 'account_acceptances', column: 'authority_basis',
      reason: 'whether this person can bind the company (owner / individual_acknowledgement / …) — a fact about signing authority, and the one column that stops an invited member reading as an owner' },
    { table: 'account_acceptances', column: 'accepted_at',
      reason: 'when the HUMAN accepted — the legal fact the row exists to record; a staff-lifecycle timestamp, not consumer-DSAR scope' },
    { table: 'account_acceptances', column: 'created_at',
      reason: 'when the row was written, deliberately distinct from accepted_at — a processing timestamp, not personal data' },
    { table: 'account_acceptances', column: 'tenant_id',
      reason: 'tenant scope key, not personal data' },
    { table: 'account_acceptances', column: 'id',
      reason: 'opaque primary key' },
    // Pay splits (#278). A split is a payroll record about a STAFF member, held
    // under accounting and employment obligations. A client's erasure request
    // never reaches it — the client is not the data subject here. Declared
    // rather than left silent: the PII heuristic flags none of these columns,
    // and silence is not the same as a decision.
    { table: 'inspection_service_pay_splits', column: 'user_id',
      reason: 'payroll record for a staff member, retained under accounting and employment obligations; not client data, so a client erasure request does not reach it' },
    { table: 'inspection_service_pay_splits', column: 'reason',
      reason: 'free text a manager writes about a payout adjustment to a staff member — payroll audit trail, not consumer-DSAR scope' },
    { table: 'service_pay_rules',             column: 'user_id',
      reason: 'staff compensation rule — not consumer-DSAR scope' },
    // The portal->core dead-letter queue (#276). Registered although the PII
    // heuristic flags neither column, because silence here is exactly how this
    // one hid: `envelope` and `reason` look like nothing.
    { table: 'parked_cmd_events', column: 'envelope',
      reason: 'Fingerprint only (type/dataschema/id/seq/size/digest) — the command payload is never written, so no subject PII reaches this table. It WAS payload-bearing before #276, when a cmd.tenant.update that failed to parse wrote an admin password hash here. Naming that history is deliberate: an out-of-scope entry that only says "no PII" invites restoring raw parking as a debugging convenience.' },
    { table: 'parked_cmd_events', column: 'reason',
      reason: 'Fixed diagnostic enum (parse-failed / unknown-type-or-version), not personal data.' },
    // Repair-request line items (#88) — the report-derived snapshot columns.
    // These are machine-copied off the published report card at add time, not
    // typed by anyone on this table: defect prose the INSPECTOR wrote about the
    // property, frozen so the shared list stays readable after the report
    // changes. They are declared as a group because they are one question, and
    // declared at all because `comment_snapshot` was on #88's list and the
    // honest answer needs saying out loud: the report content these copy from
    // carries NO manifest rule of its own, so this is not a decision inherited
    // from a ruled source. It is the same call, made here for the first time.
    // The subject's OWN lists never reach this reasoning — those rows are
    // deleted whole by the `created_by_ref` rule above.
    { table: 'repair_request_items', column: 'comment_snapshot', reason: 'frozen copy of the inspector-authored defect comment on the published report — professional content about the property, not prose about or by the data subject' },
    { table: 'repair_request_items', column: 'defect_title_snapshot', reason: 'frozen copy of the report defect title — inspector-authored content about the property' },
    { table: 'repair_request_items', column: 'location_snapshot', reason: 'frozen copy of the defect location WITHIN the property ("primary bathroom"), not a postal address' },
    { table: 'repair_request_items', column: 'category_snapshot', reason: 'frozen copy of the report defect category — tenant taxonomy value, not personal data' },
    { table: 'repair_request_items', column: 'trade_snapshot', reason: 'resolved trade label ("licensed roofer") snapshotted at add time — tenant taxonomy value, not personal data' },
    { table: 'repair_request_items', column: 'section_title', reason: 'frozen copy of the report section heading — template structure, not personal data' },
    { table: 'repair_request_items', column: 'item_label', reason: 'frozen copy of the report item label — template structure, not personal data' },
    // Declared here rather than left silent, and the honest note about WHY it
    // needed declaring: no gate asked for it. `check-erasure-manifest.mjs`
    // matches a fixed PII name pattern and `repair_action_tag` matches nothing,
    // so this column was invisible to `lint:erasure` from the moment it existed.
    // It is pinned in the coverage spec's HEURISTIC_BLIND_SPOTS list for exactly
    // that reason — that list is the population found by reading.
    { table: 'repair_request_items', column: 'repair_action_tag', reason: 'the buyer\'s requested remedy on one line (repair / replace / fund / other) — a four-value classification of a defect, chosen from a fixed list, carrying no free text and naming nobody. Not prose about or by the data subject, and unlike `note` it cannot be made to hold any: the enum is enforced at the request boundary' },
    // Sits inside the address family by name and outside it by substance: it
    // records WHEN the geocode ran, not where the property is. Excluded rather
    // than retained so the retain rules above stay a list of columns that
    // actually hold the address.
    { table: 'inspections', column: 'address_geocoded_at', reason: 'timestamp recording when the address was geocoded — a processing record, not the address itself' },

    // ── ai_content_reviews (AI governance — review evidence) ──────────────────
    // One row per human review of model-assisted text: which artifact was
    // reviewed, by which staff user, at what time, against which
    // `ai_call_provenance` row. The sibling ledger `ai_call_provenance` is
    // recorded in `erasure-manifest.ts` as `retain`; this table is recorded HERE
    // instead, and the difference is deliberate rather than editorial.
    //
    // WHY THE REGISTER AND NOT A RULE. A `retain` rule is an answer to "what do
    // we do with the data subject's data on this table". There is none: the row
    // holds a STAFF identity, two opaque ids, an enum and a timestamp, and no
    // part of the reviewed text — the same design constraint as the provenance
    // ledger, for the same reason (an inspector's defect note routinely names
    // the client and the property, so neither table may hold what was said). The
    // manifest's own reviewer note on `ai_call_provenance` says columns carrying
    // no personal data belong in this file; those eight are here by that logic
    // too, just not yet moved.
    //
    // ⚠️ WHAT WOULD CHANGE THIS. A column carrying any part of the reviewed
    // prose, or an identifier of a CONTACT rather than of a staff user. Either
    // one makes a row subject-linkable and needs a manifest rule with a basis, a
    // period, and something that enforces the period.
    //
    // ⚠️ NOTHING WENT RED TO PRODUCE THIS BLOCK. `PII_HEURISTIC` in
    // `scripts/check-erasure-manifest.mjs` matches no column on this table —
    // not `reviewed_by`, not `artifact_id` — so the table could have shipped and
    // `lint:erasure` would have stayed green. `reviewed_by` and `artifact_id`
    // are pinned in the coverage spec's HEURISTIC_BLIND_SPOTS so that the
    // declaration is enforced by something rather than merely present.
    { table: 'ai_content_reviews', column: 'reviewed_by',
      reason: 'the STAFF user who reviewed model-assisted text before publication — an accountability record of an employee professional act, the same posture as report_signoff.person_id and tenant_legal_versions.published_by_user_id. Staff offboarding lifecycle, not consumer-DSAR scope' },
    // ⚠️ Both reasons below were written when `artifact_type` had ONE member and
    // described a second that was never added. `artifact_id` named
    // `report_versions` — the table the enum comment in `schema/ai.ts` explicitly
    // REJECTED, because `report_versions.summary` is the amendment reason and not
    // a narrative — and `artifact_type` called itself two-value while the enum
    // held one. Corrected in the change that added the real second member,
    // `report` -> `reports.inspector_narrative`. The classification is unaffected;
    // what changes is that the reason now names the tables that exist.
    { table: 'ai_content_reviews', column: 'artifact_id',
      reason: 'opaque primary key of the inspection_results or reports row that received the text; that row carries its own rules (reports.inspector_narrative is erased in place by its own rule in the erasure manifest), the same answer as reports.inspection_id. Holds no part of the reviewed prose' },
    { table: 'ai_content_reviews', column: 'artifact_type',
      reason: 'two-value enum (inspection_result | report) naming WHICH table artifact_id points into — a pointer discriminator, not personal data' },
    { table: 'ai_content_reviews', column: 'ai_call_id',
      reason: 'pointer to the ai_call_provenance row for the call, itself call metadata with no subject linkage (see the ai_call_provenance block in erasure-manifest.ts)' },
    { table: 'ai_content_reviews', column: 'reviewed_at',
      reason: 'timestamp recording when the review happened — a processing record about a staff action, not personal data of any data subject' },
    { table: 'ai_content_reviews', column: 'tenant_id',
      reason: 'tenant scope key, not personal data' },
    { table: 'ai_content_reviews', column: 'id',
      reason: 'opaque primary key' },
];
