/**
 * Track I-a GDPR (spec §5) — the erasure manifest. A schema-annotated catalogue
 * of PII columns and the action to take on a data-subject erasure request,
 * adopting the Fides *pattern* (data categories + masking strategy + decision
 * log) hand-rolled for single-Worker + D1 with zero external SaaS.
 *
 * One entry per PII column. The orchestrator (G2) walks these rules, decides per
 * rule + row-state, executes, and writes one `erasure_log` decision row.
 *
 * G2 fills `ERASURE_MANIFEST`; this scaffold (G1) ships the type + an empty array.
 *
 * Executor: `erasure-orchestrator.ts` — the concrete Drizzle executor that
 * realizes these rules. Binding verified by
 * `tests/unit/erasure-manifest-coverage.spec.ts` (drift guard).
 */

/**
 * A single PII-column erasure rule.
 */
export interface ErasureRule {
    /** Table the column lives on (snake_case DB name). */
    table: string;
    /** Column to act on (snake_case DB name). */
    column: string;
    /** Fideslang-style data category, e.g. 'user.contact.email'. */
    category: string;
    /** Masking strategy for this column on erasure. */
    action: 'delete' | 'null' | 'hash' | 'retain' | 'anonymize';
    /**
     * Required when the action retains/anonymizes evidence rather than deleting
     * it — the GDPR Art. 17(3) exemption invoked. art_17_3_b = legal obligation;
     * art_17_3_e = establishment/exercise/defence of legal claims.
     */
    legalBasis?: 'art_17_3_b' | 'art_17_3_e';
    /**
     * ISO-8601 duration hint, e.g. 'P6Y'. Advisory only — the runtime retention
     * value comes from `tenant_configs.agreement_retention_years`.
     */
    retention?: string;
    /** Row-state predicate restricting which rows this rule applies to. */
    condition?: 'signed_only' | 'draft_only';
}

/**
 * The erasure manifest — one entry per PII COLUMN on an erasure-relevant table.
 *
 * Row-deletion convention (read before editing): the manifest describes
 * COLUMN-LEVEL actions only. When a draft/unsigned envelope must be removed as a
 * ROW, that is expressed by `action: 'delete'` + `condition: 'draft_only'` on a
 * sentinel rule (one per envelope table). The orchestrator treats any
 * `draft_only` delete rule on a table as "delete the matching ROWS" rather than
 * clearing the named column — the `column` on those rules names the locator
 * column (the email we matched on) for documentation, not a column to null.
 * Column-level `anonymize`/`null` rules act in-place on the named column.
 *
 * Signed-agreement PII columns -> `anonymize` + `legalBasis: 'art_17_3_e'`
 * (establishment/exercise/defence of legal claims) + `condition: 'signed_only'`,
 * keeping signature_base64 / signed_at / the audit chain (spec §3 D5).
 */
export const ERASURE_MANIFEST: ErasureRule[] = [
    // ── agreement_signers (signed evidence: anonymize the satellite PII) ──────
    { table: 'agreement_signers', column: 'name',                 category: 'user.name',                   action: 'anonymize', legalBasis: 'art_17_3_e', retention: 'P6Y', condition: 'signed_only' },
    { table: 'agreement_signers', column: 'email',                category: 'user.contact.email',          action: 'anonymize', legalBasis: 'art_17_3_e', retention: 'P6Y', condition: 'signed_only' },
    { table: 'agreement_signers', column: 'ip_address',           category: 'user.device.ip_address',      action: 'anonymize', legalBasis: 'art_17_3_e', retention: 'P6Y', condition: 'signed_only' },
    { table: 'agreement_signers', column: 'user_agent',           category: 'user.device.user_agent',      action: 'anonymize', legalBasis: 'art_17_3_e', retention: 'P6Y', condition: 'signed_only' },
    { table: 'agreement_signers', column: 'on_behalf_of',         category: 'user.name',                   action: 'anonymize', legalBasis: 'art_17_3_e', retention: 'P6Y', condition: 'signed_only' },
    { table: 'agreement_signers', column: 'on_behalf_disclaimer', category: 'user.contact',                action: 'anonymize', legalBasis: 'art_17_3_e', retention: 'P6Y', condition: 'signed_only' },
    // Draft/unsigned signer rows ride with their envelope deletion (below).
    { table: 'agreement_signers', column: 'email',                category: 'user.contact.email',          action: 'delete',    condition: 'draft_only' },

    // ── agreement_requests (envelope) ─────────────────────────────────────────
    // Signed envelope: anonymize the denormalized client identity, keep the seal.
    { table: 'agreement_requests', column: 'client_name',  category: 'user.name',          action: 'anonymize', legalBasis: 'art_17_3_e', retention: 'P6Y', condition: 'signed_only' },
    { table: 'agreement_requests', column: 'client_email', category: 'user.contact.email', action: 'anonymize', legalBasis: 'art_17_3_e', retention: 'P6Y', condition: 'signed_only' },
    // Draft/unsigned envelope: delete the ROW (locator = client_email).
    { table: 'agreement_requests', column: 'client_email', category: 'user.contact.email', action: 'delete', condition: 'draft_only' },

    // ── contacts (CRM client/agent PII) ───────────────────────────────────────
    // `name` is NOT NULL, and a CRM contact carries no legal-evidence retention
    // basis, so the row is DELETED outright (locator = email) rather than nulled.
    // This is the LIVE source of client PII (the `inspections.client_*` columns
    // are a frozen, unread cache — see the `inspection_people` rule below).
    { table: 'contacts', column: 'email', category: 'user.contact.email', action: 'delete' },

    // ── inspection_people (orphan cleanup) ────────────────────────────────────
    // No PII of its own — an inspection<->contact<->role join row. Deleted
    // (ordered BEFORE the contacts delete above) so no row dangles at the
    // soon-to-be-deleted contact id. `column` names the join key used to find
    // the subject's rows (via contacts.email), not a column to null.
    { table: 'inspection_people', column: 'contact_id', category: 'user.contact.email', action: 'delete' },

    // ── notification_preferences (orphan cleanup) ─────────────────────────────
    // No PII of its own — an answer to "send me this or don't", keyed on the
    // contact id. Ids are REUSED after an erasure, so a surviving row hands the
    // next person at that id the erased subject's mute settings: silently, and
    // in the direction that withholds mail nobody asked to withhold. Deleted
    // BEFORE the contacts delete, via the same contact-id resolution.
    // Staff rows (`subject_kind = 'user'`) are untouched — employees are not
    // consumer data subjects (see ERASURE_OUT_OF_SCOPE below).
    { table: 'notification_preferences', column: 'subject_id', category: 'user.contact.email', action: 'delete' },

    // ── invoices (#88) ────────────────────────────────────────────────────────
    // The money record is the tenant's ledger (P-4 authority chain) and stays;
    // the denormalized client identity is nulled in place. Rows are located by
    // client_email OR the subject's contact id (an invoice may carry only the
    // contact reference, never the email).
    { table: 'invoices', column: 'client_name',  category: 'user.name',          action: 'null' },
    { table: 'invoices', column: 'client_email', category: 'user.contact.email', action: 'null' },

    // ── order_payments ────────────────────────────────────────────────────────
    // The payment ledger is append-only and financial: the ROWS are retained
    // under the accounting/tax obligation (Art. 17(3)(b)) and the amounts are
    // declared out of scope below. `note` is the one free-text column a human
    // writes on a row linked to an identified client ("check from J. Smith,
    // 123 Oak St"), so it is cleared in place rather than left standing.
    { table: 'order_payments', column: 'note', category: 'user.freetext', action: 'anonymize', legalBasis: 'art_17_3_b' },

    // ── concierge_confirm_tokens (#88) ────────────────────────────────────────
    // Single-use magic-link tokens addressed to the subject: delete the ROWS
    // (locator = client_email). Nothing references a token row.
    { table: 'concierge_confirm_tokens', column: 'client_email', category: 'user.contact.email', action: 'delete' },

    // ── inspection_access_tokens (#88) ────────────────────────────────────────
    // The subject's persistent portal links: delete the ROWS (locator =
    // recipient_email). This deliberately REVOKES portal access — an erased
    // subject's magic links must stop working.
    { table: 'inspection_access_tokens', column: 'recipient_email', category: 'user.contact.email', action: 'delete' },

    // ── inspection_requests (#88) ─────────────────────────────────────────────
    // Public booking requests. The ROW must survive — `inspections.request_id`
    // carries a frozen legacy FK to it — so identity is cleared in place:
    // nullable email/phone -> NULL, NOT NULL name -> the '[erased]' sentinel.
    // Basis: the converted request is part of the engagement record the
    // inspection stands on (same posture as agreement_requests).
    { table: 'inspection_requests', column: 'client_name',  category: 'user.name',           action: 'anonymize', legalBasis: 'art_17_3_e' },
    { table: 'inspection_requests', column: 'client_email', category: 'user.contact.email',  action: 'null' },
    { table: 'inspection_requests', column: 'client_phone', category: 'user.contact.phone_number', action: 'null' },

    // ── email_suppressions (#88) ──────────────────────────────────────────────
    // APPEND-ONLY opt-out ledger. RETAINED on erasure: the suppression row is
    // the mechanism that keeps honoring the subject's objection — deleting it
    // would resume sending if the address ever re-enters the system.
    { table: 'email_suppressions', column: 'email', category: 'user.contact.email', action: 'retain', legalBasis: 'art_17_3_b' },

    // ── evidence ledgers retained under Art. 17(3) ────────────────────────────
    // automation_logs.recipient holds emails and E.164 numbers; the ledger is
    // the delivery/consent evidence trail and is retained permanently (upstream
    // #276 — indexes, not deletion).
    { table: 'automation_logs', column: 'recipient', category: 'user.contact', action: 'retain', legalBasis: 'art_17_3_e' },
    // TCPA consent ledger — append-only proof a grant/revoke happened.
    { table: 'sms_consent_log', column: 'ip',         category: 'user.device.ip_address',  action: 'retain', legalBasis: 'art_17_3_b' },
    { table: 'sms_consent_log', column: 'user_agent', category: 'user.device.user_agent',  action: 'retain', legalBasis: 'art_17_3_b' },
    // The erasure decision record itself (Art. 5(2)/30 accountability — you
    // cannot prove you honored a request if you delete the record of it).
    { table: 'erasure_log', column: 'subject_email', category: 'user.contact.email', action: 'retain', legalBasis: 'art_17_3_b' },
    // Signature evidence kept on a DSAR (the retention sweep destroys it past
    // the window); the esign audit chain is NEVER touched.
    { table: 'agreement_signers',  column: 'signature_base64', category: 'user.biometric.signature', action: 'retain', legalBasis: 'art_17_3_e', retention: 'P6Y' },
    { table: 'agreement_requests', column: 'signature_base64', category: 'user.biometric.signature', action: 'retain', legalBasis: 'art_17_3_e', retention: 'P6Y' },
    { table: 'esign_audit_logs',   column: 'signature',        category: 'system.integrity',         action: 'retain', legalBasis: 'art_17_3_e' },

    // ── reports ───────────────────────────────────────────────────────────────
    // A report is findings about a named person's property, and `title` is the
    // one free-text column a human writes — it routinely carries the address
    // ("123 Oak St — Radon"). Anonymised rather than deleted: the row is the
    // spine of a signed, delivered document, and removing it would strand the
    // version chain that proves what was delivered.
    { table: 'reports', column: 'title', category: 'user.address', action: 'anonymize', legalBasis: 'art_17_3_e', retention: 'P6Y' },

    // ── audit_logs (#276) ─────────────────────────────────────────────────────
    // Free-form JSON a caller composes; it MAY embed names/emails/phones/
    // addresses. `audit.ts` now strips the machine-detectable identifiers at
    // write time, but prose is not detectable at all and historical rows
    // predate the redactor — so the column is SCRUBBED wholesale on an erasure,
    // the same call portal's review made on the identical `details` column
    // (retaining it through an erasure is an incomplete DSAR). The ROW stays:
    // the security/accountability trail is the retention basis, and what makes
    // it one is the structured event (action/entity), not the blob.
    // `ip_address` stays too — staff-action security trail, declared out of
    // scope below.
    { table: 'audit_logs', column: 'metadata', category: 'user.freetext', action: 'anonymize', legalBasis: 'art_17_3_b' },
];

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
    // A report is findings about a named person's property. Only `title` is
    // free text a human writes, and it routinely carries the address ("123 Oak
    // St — Radon"). The rest of the row is ids, enums and a timestamp, declared
    // out of scope below.
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
];
