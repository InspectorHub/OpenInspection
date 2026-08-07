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

    // Staff, not data subjects. Consumer-DSAR erasure never touches employee
    // accounts; staff offboarding is a separate lifecycle.
    { table: 'users',               column: 'email',                     reason: 'staff account — not consumer-DSAR scope' },
    { table: 'users',               column: 'phone',                     reason: 'staff account — not consumer-DSAR scope' },
    { table: 'users',               column: 'default_signature_base64',  reason: 'inspector (staff) signature asset' },
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
    { table: 'agreement_requests',  column: 'inspector_signature_base64', reason: 'inspector (staff) countersignature' },

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
    { table: 'report_versions',       column: 'signature',                reason: 'report-content integrity seal, not personal data' },
    // ── reports ───────────────────────────────────────────────────────────────
    // A report is findings about a named person's property. `title` is the only
    // non-id column, and it is system-written — a literal or a snapshot of a
    // tenant catalogue service name — so it has its own `anonymize` rule rather
    // than an entry here. The rest of the row is ids, enums and a timestamp,
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
    // The payment ledger. The `note` column has its own anonymize rule above;
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
    // Sits inside the address family by name and outside it by substance: it
    // records WHEN the geocode ran, not where the property is. Excluded rather
    // than retained so the retain rules above stay a list of columns that
    // actually hold the address.
    { table: 'inspections', column: 'address_geocoded_at', reason: 'timestamp recording when the address was geocoded — a processing record, not the address itself' },
];
