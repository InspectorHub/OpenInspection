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
 * ⚠️ HOW MUCH WEIGHT THIS FILE'S PROSE CAN CARRY. On 2026-08-07 two separate
 * justifications in here were checked against the code and found FALSE: the
 * `reports.title` rule claimed a column "a human writes" that is in fact
 * system-written with no API that can edit it (corrected below, with an
 * amendment history rather than a silent overwrite), and `repair_requests.
 * created_by_ref` was documented as an opaque id while the code stores an email
 * address in it — a compliance classification resting on a comment that had been
 * wrong for as long as the feature existed. Both rules survived review because
 * their reasoning read well. A premise stated in a comment is not evidence:
 * before you rely on one of these paragraphs, go read what writes the column.
 *
 * Executor: `erasure-orchestrator.ts` — the concrete Drizzle executor that
 * realizes these rules. Binding verified by
 * `tests/unit/privacy/erasure-manifest-coverage.spec.ts` (drift guard).
 */

/**
 * A single PII-column erasure rule.
 */
export interface ErasureRule {
    /** Table the column lives on (snake_case DB name). */
    table: string;
    /** Column to act on (snake_case DB name). */
    column: string;
    /**
     * Fideslang-style data category, e.g. 'user.contact.email'.
     *
     * ⚠️ THIS IS OUR CLASSIFICATION, NOT A LEGAL FINDING. Counsel raised this
     * directly (round 16 full review, 2026-08-15): a category here records how
     * WE choose to govern a column, and must never be cited downstream as a
     * determination that the law classifies it that way.
     *
     * The live example is `user.biometric.signature` on the two signature
     * columns. Whether a signature image is Art. 9 "biometric data" turns on
     * whether it is processed by specific technical means FOR THE PURPOSE of
     * uniquely identifying a natural person — which an image of a handwritten
     * signature does not satisfy merely by being a signature. We keep the
     * conservative label because governing it tightly costs us nothing; that
     * choice is not a conclusion that Art. 9 applies, and a later document
     * asserting so on the strength of this string would be wrong.
     *
     * Counsel named the failure mode from our own history: an internal
     * classification read by the next legal document as an established fact.
     */
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
    /**
     * Whether anything ACTUALLY expires this data, for rules that promise a
     * bounded `retention`. Required on every `retain` rule that declares one,
     * with no default: a retain nobody enforces is an unbounded retain, which is
     * the blanket exclusion this manifest exists to avoid, and silence is how it
     * would get there. 'enforced' = a sweep acts when the window elapses;
     * 'pending' = the decision is recorded, the expiry is not built yet.
     *
     * `pending` is not self-service. `scripts/check-erasure-manifest.mjs` holds
     * a checked-in list of the rules allowed to be pending and refuses any
     * other, so adding one is a reviewed diff rather than a keyword.
     */
    enforcementStatus?: 'enforced' | 'pending';
    /**
     * ISO date (YYYY-MM-DD) by which a `pending` rule must become enforced.
     * Required when `enforcementStatus` is 'pending', and the gate FAILS once it
     * passes — a deadline that cannot act is how "pending" becomes permanent.
     * Moving it is allowed; moving it silently is what this prevents.
     */
    enforcementDeadline?: string;
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

    // ── report_views (#271) ───────────────────────────────────────────────────
    // Delivery-confirmation counters: this recipient rendered this order's
    // report page, first/last, this many times. A behavioural fact about an
    // identified person, and the PII heuristic matches NOTHING here — not
    // `view_count`, not `first_viewed_at`, not `access_token_id`. The gate was
    // green over this table the entire time it existed.
    //
    // DELETE the ROWS. Zeroing the counters is not an option: an all-zero row
    // still asserts that this person was sent this document. Locator =
    // `access_token_id`, the only route back to the subject (there is no email
    // on this table), which is why the orchestrator resolves the token ids and
    // deletes here BEFORE deleting `inspection_access_tokens`.
    //
    // The action is not a new judgement. `docs/compliance/report-view-lia.md`
    // condition 7 already required it ("the row is catalogued for erasure in the
    // same change that creates it, and the erasure orchestrator is wired to
    // it... the subject's rows must be removed before their access tokens are"),
    // and the schema comment on `reportViews` states the same. What was missing
    // was any code or catalogue entry that did it — the condition read as met
    // because two documents said so and nothing checked.
    { table: 'report_views', column: 'access_token_id', category: 'user.behavior', action: 'delete' },

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
    // The two free-text columns on the SAME row, which carry the subject data
    // the accountability record is made of and which the heuristic does not
    // match. `identity_basis` is documented as free text ("how the identity was
    // verified"), so it can hold whatever document a human named; `response_note`
    // is literally what was said back to the subject. Retaining `subject_email`
    // and leaving these two undeclared claimed a narrower record than the row
    // actually holds. Same basis, same row, no new judgement.
    { table: 'erasure_log', column: 'identity_basis', category: 'user.freetext', action: 'retain', legalBasis: 'art_17_3_b' },
    { table: 'erasure_log', column: 'response_note',  category: 'user.freetext', action: 'retain', legalBasis: 'art_17_3_b' },
    // Signature evidence kept on a DSAR (the retention sweep destroys it past
    // the window); the esign audit chain is NEVER touched.
    { table: 'agreement_signers',  column: 'signature_base64', category: 'user.biometric.signature', action: 'retain', legalBasis: 'art_17_3_e', retention: 'P6Y', enforcementStatus: 'enforced' },
    { table: 'esign_audit_logs',   column: 'signature',        category: 'system.integrity',         action: 'retain', legalBasis: 'art_17_3_e' },

    // ── reports ───────────────────────────────────────────────────────────────
    // A report is findings about a named person's property. `title` is written
    // by the system, never by a person composing free text about this client:
    // it is either the literal 'Inspection Report' (`inspection/reports.ts`) or
    // a snapshot of a service line's name taken from the tenant's own catalogue
    // (`inspection/report-generation.ts`, both the insert and the adoption
    // update). No route writes it — the only other writer is the erasure
    // executor performing this very rule.
    //
    // Anonymised rather than deleted: the row is the spine of a signed,
    // delivered document, and removing it would strand the version chain that
    // proves what was delivered. A catalogue service name is tenant-authored,
    // so it cannot be assumed free of identifiers, and anonymising a title
    // costs nothing.
    //
    // AMENDMENT HISTORY
    //   Previous rationale: "`title` is the one free-text column a human writes
    //     — it routinely carries the address ("123 Oak St — Radon")."
    //   Correction date:    2026-08-07
    //   Why:                factually wrong about this codebase, in both halves.
    //     No human writes it and no API can edit it, so it cannot routinely
    //     carry a per-property address. Evidence: the two writers named above,
    //     read 2026-08-07 (E2 — verified in source, not inferred from a plan).
    //   Impact:             NONE on the processing decision. The action stays
    //     `anonymize`, the basis and the period are unchanged. What changes is
    //     the reason recorded for it.
    //   Kept rather than overwritten: an accountability record under Art. 5(2)
    //     that quietly deletes a mistake is worth less than one that shows the
    //     mistake was found and corrected.
    { table: 'reports', column: 'title', category: 'user.address', action: 'anonymize', legalBasis: 'art_17_3_e', retention: 'P6Y' },
    // `inspector_narrative` IS what the title turned out not to be: prose a person
    // composes about this property for this client, so it can carry names and
    // occupancy detail, none of it machine-detectable — the population
    // `docs/compliance/erasure-heuristic-limits.md` says the gate cannot reach.
    // Cleared WHOLESALE, the `audit_logs.metadata` call: identifiers cannot be
    // stripped out of prose. The ROW survives (spine of a signed document).
    // ⚠️ Safe for the integrity chain only because the narrative is NOT in
    // `report_versions.snapshot_json` (`report-version.service.ts` captures the
    // inspections row, results, units, inspectors, style profile — not `reports`).
    // Put it in the snapshot and this rule must be re-decided: an erasure would
    // then either leave the prose inside a signed blob or break its signature.
    { table: 'reports', column: 'inspector_narrative', category: 'user.freetext', action: 'anonymize', legalBasis: 'art_17_3_e', retention: 'P6Y' },

    // ── audit_logs (#276) ─────────────────────────────────────────────────────
    // Free-form JSON a caller composes; it MAY embed names/emails/phones/
    // addresses. `audit.ts` now strips the machine-detectable identifiers at
    // write time, but prose is not detectable at all and historical rows
    // predate the redactor — so the column is SCRUBBED wholesale on an erasure,
    // the same call portal's counsel made on the identical `details` column
    // (retaining it through an erasure is an incomplete DSAR). The ROW stays:
    // the security/accountability trail is the retention basis, and what makes
    // it one is the structured event (action/entity), not the blob.
    // `ip_address` stays too — staff-action security trail, declared out of
    // scope below.
    { table: 'audit_logs', column: 'metadata', category: 'user.freetext', action: 'anonymize', legalBasis: 'art_17_3_b' },

    // ── repair requests (#88) ─────────────────────────────────────────────────
    // The one surface where the CLIENT types prose rather than the tenant. None
    // of these column names looks like PII, which is exactly why the gate never
    // asked about them; they are ruled on because somebody read the table, not
    // because anything went red.
    //
    // `created_by_ref` is NOT NULL and, on the portal-token path, holds the
    // actor's EMAIL — a plain identifier, despite a schema comment that called
    // it an id for years. So it is both the subject PII on this table and the
    // locator for it: the ROWS the subject authored are deleted (no
    // legal-evidence basis for a client's own wish-list, and the delete revokes
    // the still-live `share_token`). `custom_intro` / `note` are cleared in
    // place on lists OTHER people built for the subject's inspections, which
    // survive as that person's record. Executor: `erase-repair-requests.ts`.
    { table: 'repair_requests',      column: 'created_by_ref', category: 'user.contact.email', action: 'delete' },
    { table: 'repair_requests',      column: 'custom_intro',   category: 'user.freetext',      action: 'null' },
    { table: 'repair_request_items', column: 'note',           category: 'user.freetext',      action: 'null' },

    // ── the property address family ───────────────────────────────────────────
    // A property address is not automatically non-personal data: on a
    // residential inspection ordered by the buyer or the homeowner it is where a
    // person lives, held against a named client through `inspection_people`.
    // Declaring the family out of scope as "property data" was considered and
    // REJECTED — it was the cheapest way back to green and the one a red gate
    // pushes you toward, which is why it was not ours to decide alone.
    //
    // RETAINED under Art. 17(3)(e) instead: the address identifies which
    // property a report describes, and the report is the inspector's defence
    // against a negligence claim. One entry per column, no wildcard — an auditor
    // reads this file, and a wildcard hides what was actually considered.
    //
    // Retained means FOR A PERIOD. The bound is the tenant's existing
    // `tenant_configs.agreement_retention_years` (default 6, hence 'P6Y'), NOT a
    // second retention column: both windows answer the same question — how long
    // a professional record must survive — for the same tenant under the same
    // state rules and the same E&O cover, and two clocks that start equal drift.
    //
    // ⚠️ NOT YET ENFORCED — deadline 2027-02-01, carried on every rule below as
    // `enforcementStatus: 'pending'` so nothing can read them as implemented.
    // `retention-sweep.ts` reaches `agreement_requests` and `agreement_signers`
    // only; nothing expires an inspection address today, so these rules record a
    // decision no code acts on yet. That gap is the distance between the rule as
    // written and the rule as honoured — NOT a licence to read 'retain' as
    // 'forever', which is the rejected exclusion under another name.
    //
    // Why that date, so the next reader can argue with it rather than inherit
    // it. The sweep is not a patch: `inspections` has no purge marker (the
    // agreement pass keys on `signedAt` + `purged_at IS NULL`, and there is no
    // equivalent here), so an idempotent sweep needs a schema change and a
    // migration first; and nobody has yet chosen which column starts the clock
    // for an inspection. Two quarters covers that work with review, and is short
    // enough to land on someone who still holds the context. It is NOT derived
    // from when the first address actually falls due — that is not computable
    // until the clock column exists, which is precisely why the date has to come
    // from review discipline instead.
    //
    // Two mechanisms keep this honest. The gate refuses any pending rule that is
    // not on its checked-in list, and FAILS outright once the deadline passes.
    // The tripwire in `tests/unit/privacy/erasure-manifest-coverage.spec.ts`
    // fails the day the sweep learns about `inspections`, so this notice cannot
    // outlive its gap either.
    { table: 'inspections', column: 'property_address',  category: 'user.address',  action: 'retain', legalBasis: 'art_17_3_e', retention: 'P6Y', enforcementStatus: 'pending', enforcementDeadline: '2027-02-01' },
    { table: 'inspections', column: 'address_place_id',  category: 'user.address',  action: 'retain', legalBasis: 'art_17_3_e', retention: 'P6Y', enforcementStatus: 'pending', enforcementDeadline: '2027-02-01' },
    { table: 'inspections', column: 'address_street',    category: 'user.address',  action: 'retain', legalBasis: 'art_17_3_e', retention: 'P6Y', enforcementStatus: 'pending', enforcementDeadline: '2027-02-01' },
    { table: 'inspections', column: 'address_city',      category: 'user.address',  action: 'retain', legalBasis: 'art_17_3_e', retention: 'P6Y', enforcementStatus: 'pending', enforcementDeadline: '2027-02-01' },
    { table: 'inspections', column: 'address_state',     category: 'user.address',  action: 'retain', legalBasis: 'art_17_3_e', retention: 'P6Y', enforcementStatus: 'pending', enforcementDeadline: '2027-02-01' },
    { table: 'inspections', column: 'address_zip',       category: 'user.address',  action: 'retain', legalBasis: 'art_17_3_e', retention: 'P6Y', enforcementStatus: 'pending', enforcementDeadline: '2027-02-01' },
    { table: 'inspections', column: 'address_county',    category: 'user.address',  action: 'retain', legalBasis: 'art_17_3_e', retention: 'P6Y', enforcementStatus: 'pending', enforcementDeadline: '2027-02-01' },
    { table: 'inspections', column: 'address_lat',       category: 'user.location', action: 'retain', legalBasis: 'art_17_3_e', retention: 'P6Y', enforcementStatus: 'pending', enforcementDeadline: '2027-02-01' },
    { table: 'inspections', column: 'address_lng',       category: 'user.location', action: 'retain', legalBasis: 'art_17_3_e', retention: 'P6Y', enforcementStatus: 'pending', enforcementDeadline: '2027-02-01' },
    // The booking request the inspection was converted from. Its client_name /
    // client_email / client_phone are already cleared in place above while the
    // ROW survives, so the address is the one part of that record still
    // standing — the same question, answered the same way rather than
    // differently by omission.
    { table: 'inspection_requests', column: 'property_address', category: 'user.address', action: 'retain', legalBasis: 'art_17_3_e', retention: 'P6Y', enforcementStatus: 'pending', enforcementDeadline: '2027-02-01' },

    // ── ai_call_provenance (AI governance ledger) ─────────────────────────────
    // One row per prompt sent to a model provider: which capability ran, which
    // adapter, on whose credentials, against which model, under which prompt
    // version, when. Written at the single AI chokepoint
    // (`AIService.callGemini`) so no AI feature can produce output without one.
    //
    // EVERY COLUMN IS LISTED, INCLUDING THE ONES THAT OBVIOUSLY HOLD NO PII.
    // Not one of these names matches `PII_HEURISTIC` in
    // `scripts/check-erasure-manifest.mjs`, so this whole table could have been
    // added and `lint:erasure` would have stayed green — the exact failure
    // `docs/compliance/erasure-heuristic-limits.md` describes, where silence
    // reads as coverage. The table is ruled on because somebody read it, not
    // because anything went red.
    //
    // WHY `retain` AND NOT A DELETION. There is nothing here to locate a data
    // subject BY and nothing to erase: the row records that a workspace made an
    // AI call, and it is scoped to the tenant, not to a person. That is a
    // design constraint, not a coincidence — the prompt text is deliberately
    // never stored (see the schema comment on `ai_call_provenance`) precisely
    // so this ledger cannot become a second copy of the client PII an
    // inspector's defect note carries. A DSAR over this table has no rows to
    // find. Basis art_17_3_b: it is the record that shows what an automated
    // system did on the tenant's behalf, and a governance log you can delete on
    // request cannot serve as one.
    //
    // NO `retention` PERIOD IS DECLARED, deliberately. A period here would be a
    // promise about expiring PERSONAL data, and these columns are not personal
    // data; declaring one would also require an `enforcementStatus`, and there
    // is no sweep — the shape this manifest calls an unbounded retain wearing a
    // temporary label. If a future column makes a row subject-linkable, that
    // column changes this reasoning and needs a period AND something to enforce
    // it.
    //
    // ⚠️ REVIEWER NOTE. Columns that carry no personal data would normally be
    // declared in `ERASURE_OUT_OF_SCOPE` (`erasure-out-of-scope.ts`) with a
    // reason, which is arguably where these eight belong. They are recorded
    // here instead because a separate erasure-coverage audit was in flight over
    // that file when this landed and a concurrent edit to it would have been a
    // collision, not a decision. Moving them is a mechanical change and loses
    // nothing: the reasoning above travels with them.
    { table: 'ai_call_provenance', column: 'id',             category: 'system.operations', action: 'retain', legalBasis: 'art_17_3_b' },
    { table: 'ai_call_provenance', column: 'tenant_id',      category: 'system.operations', action: 'retain', legalBasis: 'art_17_3_b' },
    { table: 'ai_call_provenance', column: 'capability',     category: 'system.operations', action: 'retain', legalBasis: 'art_17_3_b' },
    { table: 'ai_call_provenance', column: 'provider',       category: 'system.operations', action: 'retain', legalBasis: 'art_17_3_b' },
    { table: 'ai_call_provenance', column: 'mode',           category: 'system.operations', action: 'retain', legalBasis: 'art_17_3_b' },
    { table: 'ai_call_provenance', column: 'model',          category: 'system.operations', action: 'retain', legalBasis: 'art_17_3_b' },
    { table: 'ai_call_provenance', column: 'prompt_version', category: 'system.operations', action: 'retain', legalBasis: 'art_17_3_b' },
    { table: 'ai_call_provenance', column: 'created_at',     category: 'system.operations', action: 'retain', legalBasis: 'art_17_3_b' },
];
