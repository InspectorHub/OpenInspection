/**
 * OI #276 — the log-table retention manifest.
 *
 * The companion catalogue to `erasure-manifest.ts`, and a DIFFERENT question
 * from it. Erasure answers "a named person asked us to forget them, what
 * happens?"; this answers "nobody asked, and the data is still here — what
 * expires it?" (GDPR Art. 5(1)(e) storage limitation). A table can be entirely
 * correct under the first and indefensible under the second, which is why the
 * two lists are separate and why a table has to appear in one of these three
 * arrays or the gate (`scripts/check-retention-manifest.mjs`) fails.
 *
 * ── The numbers live next door ──────────────────────────────────────────────
 * `retention-windows.ts` holds every period and the reason for it, one constant
 * per clock, and this file re-exports them so no import site cares which of the
 * two it came from. That file is where you go to change HOW LONG; this one is
 * WHICH TABLES and WHAT ACTION. `retention-rule-types.ts` holds the SHAPES —
 * what a rule, an exclusion and an open question may say — and is re-exported
 * here for the same reason.
 *
 * ⚠️ The three ARRAYS stay in this file whatever else moves out of it. Both
 * gates open this path and parse them out of the source text, so relocating one
 * does not fail loudly: the manifest gate exits on "could not locate" and the
 * policy gate hashes an empty parse.
 *
 * ── Erase-in-place means the actor does not survive ─────────────────────────
 * `erase_in_place` on this list is the same verb the erasure orchestrator uses,
 * and it has to keep meaning the same thing: the structured event survives, the
 * identifiers do not — including free text. A rule that scrubbed identifier
 * columns and left prose behind would claim a legal outcome it does not
 * deliver. The column sets come from the shared satellite-PII module for
 * exactly that reason (see `retention-logs.ts`).
 *
 * The verb is deliberately NOT called `anonymize`, here or in the erasure
 * manifest. The old name was retired because writing a
 * sentinel over identifier columns in a surviving row is not CCPA
 * deidentification and not GDPR anonymisation, and the name invited a future
 * reader to cite it as proof that it was.
 *
 * ── Scope: platform-operational logs ────────────────────────────────────────
 * This catalogue governs the platform's own operational record surface. A
 * business record (a report, a message to a counterparty, a notice a contact
 * reads) is product data whose lifetime is the erasure manifest's question and
 * the inspection record window's, not an operational log window's. The gate's
 * header states where that line is drawn and which tables sit on the far side
 * of it.
 */

export * from './retention-windows';
export * from './retention-rule-types';
import type {
    RetentionRule,
    RetentionOutOfScopeEntry,
    RetentionOpenEntry,
} from './retention-rule-types';
import {
    AUDIT_LOG_ANONYMIZE_MONTHS,
    DEDUP_LOG_RETENTION_DAYS,
    DEAD_LETTER_RETENTION_DAYS,
    SYNC_OUTBOX_RETENTION_DAYS,
    IDEMPOTENCY_REPLAY_RETENTION_DAYS,
    DESTRUCTION_RECORD_RETENTION_MONTHS,
    AI_ASSURANCE_RETENTION_MONTHS,
    REPORT_VERSION_RETENTION_MONTHS,
    SMS_DISCLOSURE_RETENTION_MONTHS,
    NOTIFICATION_RETENTION_MONTHS,
    QBO_SYNC_ERROR_RESOLVED_RETENTION_DAYS,
    TENANT_LEGAL_VERSION_RETENTION_MONTHS,
    MARKETPLACE_IMPORT_HISTORY_RETENTION_MONTHS,
    SLUG_HISTORY_RETENTION_MONTHS,
    REPORT_PDF_DEFAULT_RETENTION_MONTHS,
    MIGRATION_INTAKE_ASSISTED_RETENTION_DAYS,
} from './retention-windows';

export const RETENTION_MANIFEST: RetentionRule[] = [
    {
        table: 'audit_logs',
        timestampColumn: 'created_at',
        window: { unit: 'months', value: AUDIT_LOG_ANONYMIZE_MONTHS },
        action: 'erase_in_place',
        purpose: 'PII-bearing audit trail. Two years covers a dispute cycle plus the audit that follows it; past that the structured event (action, entity_type, entity_id) is the only part worth keeping, so the actor and the free-text metadata go and the row stays.',
        legalHold: 'tenant_scoped',
    },
    {
        table: 'processed_webhook_events',
        timestampColumn: 'received_at',
        window: { unit: 'days', value: DEDUP_LOG_RETENTION_DAYS },
        action: 'delete',
        purpose: 'Replay-protection ledger for inbound provider webhooks. It only has to outlive a provider retry window, measured in hours; nothing reads a row older than the window.',
        legalHold: 'not_applicable',
        legalHoldNote: 'The row is an event id and the instant it arrived — there is no payload, no identifier and no tenant dimension. Preserving it could not answer any question a preservation order asks, and suspending it while a hold runs would grow a pure replay ledger without preserving anything.',
    },
    {
        // NOT `received_at` — the column on this table is `processed_at`. The
        // two dedup ledgers were written months apart and never converged.
        table: 'processed_cmd_events',
        timestampColumn: 'processed_at',
        window: { unit: 'days', value: DEDUP_LOG_RETENTION_DAYS },
        action: 'delete',
        purpose: 'Replay-protection ledger for the portal to core command seam. Same purpose and same retry horizon as the webhook ledger, so deliberately the same number.',
        legalHold: 'not_applicable',
        legalHoldNote: 'An event id, a command type and the instant it was processed. Same reasoning as the webhook ledger: nothing here is evidence of anything except that a duplicate was rejected, and the command it deduplicated is preserved by the tables that actually applied it.',
    },
    {
        table: 'parked_cmd_events',
        timestampColumn: 'received_at',
        window: { unit: 'days', value: DEAD_LETTER_RETENTION_DAYS },
        action: 'delete',
        purpose: 'Dead-letter queue, not a log. Its whole job is telling a human that portal and core disagree about a command shape, which is a days-to-weeks activity.',
        legalHold: 'suspend_all',
    },
    {
        // TERMINAL ROWS ONLY. The executor excludes `pending`, and that
        // exclusion is part of the rule rather than an implementation detail: a
        // pending row is unpublished WORK, not a record of work. See the
        // executor and `retention-logs.spec.ts` for the assertion that keeps it.
        table: 'sync_outbox',
        timestampColumn: 'created_at',
        window: { unit: 'days', value: SYNC_OUTBOX_RETENTION_DAYS },
        action: 'delete',
        purpose: 'Published/failed user-sync events whose payload carries staff email, name and — for user.password_changed — the password hash. Once published the row is a receipt; the only remaining reader is a human re-driving a portal/core divergence, which surfaces on a monthly reconciliation, so two cycles. PENDING rows are excluded: they are unpublished work the sweeper is still retrying, and expiring one would destroy an account change that never reached portal rather than retire a record of one.',
        legalHold: 'suspend_all',
    },
    {
        table: 'idempotency_keys',
        timestampColumn: 'created_at',
        window: { unit: 'days', value: IDEMPOTENCY_REPLAY_RETENTION_DAYS },
        action: 'delete',
        purpose: 'response_body is the verbatim success payload of a mutating API call, so it holds whatever PII that endpoint returned. Measured from created_at, NOT expires_at: that column decides whether a later caller may steal a dead claim and is never read once the row is done, so a completed row outlives it indefinitely. Seven days is seven times the store own declared 24h TTL — margin for a client re-driving a queued intent after a weekend, well inside the horizon past which the store itself says a retry is a different problem.',
        legalHold: 'tenant_scoped',
    },
    {
        table: 'tenant_destruction_records',
        timestampColumn: 'destroyed_at',
        window: { unit: 'months', value: DESTRUCTION_RECORD_RETENTION_MONTHS },
        action: 'delete',
        purpose: 'The certification that a workspace was destroyed. Non-personal (tenant id snapshot, slug, counts), so the period is set by how long someone can still ask for it rather than by storage limitation: three years covers the ordinary contractual limitation window for an SCC Clause 8.5 request and spans two annual SOC 2 audit periods. Only COMPLETED records expire — a row still reading started is an unfinished destruction, and deleting one closes an open anomaly instead of retiring a settled record. Measured from destroyed_at, the initiation time, which is the only timestamp an unfinished row has.',
        legalHold: 'tenant_scoped',
    },
    {
        table: 'ai_call_provenance',
        timestampColumn: 'created_at',
        window: { unit: 'months', value: AI_ASSURANCE_RETENTION_MONTHS },
        action: 'delete',
        purpose: 'Which prompt version and model produced a piece of assisted text. Non-personal by construction — the schema forbids prompt text — and it grows per AI call, so it needs a window rather than an exemption. Three years is the same clock as the reviews that cite it, and it MUST stay the same clock: they are one governance record split across two tables. A row a surviving review still cites does not expire, because a review is written after its call and would otherwise outlive it and read as an orphan citation.',
        legalHold: 'tenant_scoped',
    },
    {
        table: 'ai_content_reviews',
        timestampColumn: 'reviewed_at',
        window: { unit: 'months', value: AI_ASSURANCE_RETENTION_MONTHS },
        action: 'delete',
        purpose: 'That a named person reviewed the output of one AI call before it was published. Shares its clock with ai_call_provenance for the reason stated there. Three years covers the window in which a disputing customer or an auditor can still ask whether anyone checked a piece of assisted text.',
        legalHold: 'tenant_scoped',
    },
    {
        table: 'report_versions',
        timestampColumn: 'created_at',
        window: { unit: 'months', value: REPORT_VERSION_RETENTION_MONTHS },
        action: 'delete',
        purpose: 'The amendment trail behind a published report. SUPERSEDED versions only: the highest version_number for a report is what the report currently IS, carries its signature and content hash, and never expires here. What ages out is the earlier drafts and amendments behind it, three years past the point anyone is likely to question a revision.',
        legalHold: 'tenant_scoped',
    },
    {
        // REFERENCE-PRESERVING, and the executor has always been. It deletes only
        // a version that is superseded AND cited by no `sms_consent_log` row.
        // That is exactly the required behaviour; we reported it as
        // missing because we read the manifest (a table and a number) and not the
        // executor (what the number does). The window is real, its scope is not
        // what the number alone suggests.
        table: 'sms_disclosure_versions',
        timestampColumn: 'published_at',
        window: { unit: 'months', value: SMS_DISCLOSURE_RETENTION_MONTHS },
        action: 'delete',
        purpose: 'Superseded TCPA disclosure text. Retained while any consent row cites it — the consent record stores this version and its content hash and is never swept, so deleting a cited version would leave evidence naming a text nobody can produce. The current version is kept too: it is what the next opt-in shows.',
        legalHold: 'not_applicable',
        legalHoldNote: 'Protected transitively and unconditionally, which is stronger than a hold filter would be. The executor deletes a version only when NO sms_consent_log row cites it, and sms_consent_log is out of scope for retention entirely — never swept, hold or no hold. So a version cited by a held tenant’s consent record cannot be deleted, and neither can one cited by anybody else’s.',
    },
    {
        // REFERENCE-PRESERVING. The executor checked only that a
        // newer version existed, which was correct until this session added
        // `account_acceptances` — a ledger that is never swept and that names the
        // version and content hash a person was shown. It now also requires that
        // no surviving acceptance cites the row.
        table: 'tenant_legal_versions',
        timestampColumn: 'published_at',
        window: { unit: 'months', value: TENANT_LEGAL_VERSION_RETENTION_MONTHS },
        action: 'delete',
        purpose: 'Superseded tenant Privacy/Terms bodies. Retained while any account acceptance cites the version, and the live version per (tenant, doc) is never expired because the hosted legal pages render it. This is retain-while-referenced, NOT keep-forever.',
        legalHold: 'tenant_scoped',
    },
    {
        // The inbox, not the record that a communication
        // happened — `automation_logs` answers that and is retained by design, and
        // the same event writes a row in both. `inspection_id` is a soft reference
        // with no cascade, so a notice legitimately outlives its inspection, which
        // is the reason it needs a window of its own at all.
        table: 'notifications',
        timestampColumn: 'created_at',
        window: { unit: 'months', value: NOTIFICATION_RETENTION_MONTHS },
        action: 'delete',
        purpose: 'In-app notice header: a per-recipient title and body composed about an inspection. Anchored on creation rather than on read_at/archived_at — that alternative was rejected because an unread notice would become immortal, turning a UI-state field into a retention control.',
        legalHold: 'tenant_scoped',
    },
    {
        // Anchored on RESOLUTION, which is why `resolved_at`
        // exists: `updated_at` also moves on re-detection, so it says when the row
        // was last touched rather than when it stopped being outstanding.
        // Unresolved rows have a NULL anchor and are therefore never swept —
        // outstanding work, not a record of work.
        table: 'qbo_sync_errors',
        timestampColumn: 'resolved_at',
        window: { unit: 'days', value: QBO_SYNC_ERROR_RESOLVED_RETENTION_DAYS },
        action: 'delete',
        purpose: 'Resolved QuickBooks sync failures. Ninety days covers the whole row including the copied Intuit error text, which may quote a customer name — a longer window for that text is refused on data-minimisation grounds: a billing dispute is explained from the accounting records, not from an ephemeral rejection message.',
        legalHold: 'tenant_scoped',
    },
    {
        table: 'tenant_marketplace_import_history',
        timestampColumn: 'created_at',
        window: { unit: 'months', value: MARKETPLACE_IMPORT_HISTORY_RETENTION_MONTHS },
        action: 'delete',
        purpose: 'Display-only record of which catalogue version a workspace imported and when. The marker the update and replace paths actually read is tenant_library_imports, a different table, so expiring a history row shortens a list and cannot change what the next import does.',
        legalHold: 'tenant_scoped',
    },
    {
        // The first rule that reaches outside D1: the row points at an R2
        // object, so the executor deletes both or neither. Deleting the row
        // alone is worse than doing nothing — the row is the only thing that
        // knows the object's key, so the object becomes unreachable by anything
        // that could ever remove it.
        table: 'report_pdfs',
        timestampColumn: 'rendered_at',
        window: { unit: 'months', value: REPORT_PDF_DEFAULT_RETENTION_MONTHS },
        action: 'delete',
        tenantWindowColumnYears: 'report_pdf_retention_years',
        purpose: 'A rendered PDF of a property: the address, the photographs and the defects found there. Nothing expired one while the tenant lived, so a report was kept for as long as the company existed with no decision behind it. Seven years is a PLATFORM-SELECTED DEFAULT for the tenant-silent case — not a statutory retention period, and not a representation that seven years is the maximum legally required period (an earlier five-plus-two derivation was struck, because it read a longest-statutory-period claim into a number that is not one). It is informed primarily by legal-claim defence and secondarily by regulatory record retention. Each tenant may set their own period, and 0 means indefinite: an explicit controller instruction the platform executes. See lib/compliance/report-pdf-retention.ts for the disclosure wording and the jurisdiction facts with their as-of dates.',
        legalHold: 'tenant_scoped',
    },
    {
        table: 'tenant_slug_history',
        timestampColumn: 'changed_at',
        window: { unit: 'months', value: SLUG_HISTORY_RETENTION_MONTHS },
        action: 'delete',
        purpose: 'Who a released slug used to belong to, and a one-year block on reusing it. Three years is comfortably past that block (SLUG_RETIREMENT_MS), so the sweep can never release a slug early; what it retires is the lookup that answers a stale link long after anyone follows one. A row whose retired_until has not passed is kept regardless of age.',
        legalHold: 'tenant_scoped',
    },
    {
        // The second rule that reaches outside D1, and the only one whose
        // action is decided by what the row holds rather than by the table: the
        // staging entries and the uploaded object carry a third party's
        // personal data, the batch row does not. So the run's contents go and
        // the run's record survives, which is what `erase_in_place` means
        // everywhere else on this list.
        //
        // A batch row is the only thing that knows its uploaded file's key, so
        // the executor deletes the object first, the entries second and clears
        // the key last — any other order leaves an object no code path can ever
        // name again.
        //
        // ADDED LATER, AND NOT REVIEWED WITH THE OTHERS. The fifteen rules
        // above it were decided together; this one came afterwards and has not
        // had the same scrutiny. Recorded in the policy header's condition list
        // rather than left to be inferred from a date.
        table: 'migration_batches',
        timestampColumn: 'expires_at',
        window: { unit: 'days', value: MIGRATION_INTAKE_ASSISTED_RETENTION_DAYS },
        action: 'erase_in_place',
        rowWindowColumn: 'expires_at',
        purpose: 'An import run holds a third party\'s name, email address and phone number twice over: once in the staging entries and once in the uploaded file itself. Both go together on the run\'s own due date; what survives is the batch row, carrying ids, timestamps, a vendor name and the two authorisations this workspace\'s own people gave. Two lifetimes share this rule because a table gets one: a run the operator staged and walked away from expires after thirty days, and a run waiting on a person to convert its file expires after ninety. The window declared here is the longer of the two, which is the bound that is true of every row carrying a due date; the per-row due date lives on the column named above and is what the sweep compares. A batch with no due date written is left alone rather than swept at the outer bound — see rowWindowColumn. The staging entries go with the run: see the out-of-scope entry for them. Clearing a run also closes its undo window, because the entries the undo reads are the entries that go.',
        legalHold: 'tenant_scoped',
    },
];

/** @gateConsumed read as source text by `scripts/check-retention-manifest.mjs`. */
export const RETENTION_OUT_OF_SCOPE: RetentionOutOfScopeEntry[] = [
    // ── Legally-required evidence ────────────────────────────────────────────
    {
        table: 'deployment_legal_versions',
        reason: 'The only copy of the text an acceptance points at. `users.terms_accepted` stores a version and a content hash, not the body — so deleting a row here does not shrink a record, it makes an existing one unverifiable, and the signer can no longer be shown what they agreed to. The version+hash design holds only because the accepted version can be reconstructed later; a retention sweep over this table is the one thing that would make that false. Growth is bounded by publications, not by usage: a handful of rows over the life of a deployment.',
    },
    {
        table: 'statutory_form_versions',
        reason: 'Which revision of an authority’s form was in force, and when. A report produced on one revision points at that row; sweeping it would leave the reference an orphan and destroy the only answer to “which form was this inspection written under”. The same shape as `deployment_legal_versions` above, and out of scope for the same reason — it is the record a later question is asked against, not a record of a person. It carries no subject data at all: an agency name, a revision label and the dates it applied, so Art. 5(1)(e) has nothing here to attach a clock to.',
    },
    {
        table: 'account_acceptances',
        reason: 'The evidence that an account was VALIDLY CREATED, written in the same db.batch() as the users row it belongs to — one write, never two. Expiring a row here does not shrink a record — it destroys one, and it destroys it in a specific direction: the account survives while the proof that its holder accepted anything does not, which is the state account = EXISTS, acceptance_ledger = ABSENT that the table exists to make unreachable. A retention sweep would reach that state deliberately, on a timer, for every account old enough. The natural clock for this row is the ACCOUNT, not the calendar: it should die when the users row it belongs to does, which is the tenant purge and the staff offboarding lifecycle, and both already destroy it. Growth is bounded by accounts times published document versions, not by usage. Declared here although the gate never asked: the LEDGER_NAME pattern matches no part of account_acceptances, so this table could have shipped with lint:retention green — the same silence that let tenant_destruction_records go a year without a decision.',
    },
    {
        table: 'legal_holds',
        reason: 'The preservation record itself. A hold that expired on its own schedule would be a preservation instrument that failed to preserve itself, and a RELEASED hold is not spent either: the question asked afterwards is over which period this tenant’s data was preserved and who decided it no longer had to be, which only the released row can answer. Growth is bounded by legal matters, not by usage. Declared here although the gate never asked — the LEDGER_NAME pattern matches no part of `legal_holds`, so this table could have shipped with lint:retention green, the same silence that let tenant_destruction_records go a year without a decision.',
    },
    {
        table: 'sms_consent_log',
        reason: 'TCPA consent evidence. Pruning it destroys the tenant own defence against a consent challenge — the direct analogue of portal P4-D5 on suppression lists, where the record IS the protection.',
    },
    {
        table: 'erasure_log',
        reason: 'Proof that a DSAR was honoured (Art. 5(2) accountability). Deleting it means being unable to demonstrate compliance with the very request compliance was performed for.',
    },

    // ── Tamper-evident attestation ───────────────────────────────────────────
    {
        table: 'esign_audit_logs',
        reason: 'Hash-chained, signed attestation. retention-sweep.ts states never touching it as a hard rule: it is the minimal PII-light record that survives even final destruction, and removing any row breaks the chain for every row after it.',
    },

    // ── Not logs, whatever they are called ───────────────────────────────────
    {
        table: 'inspection_events',
        reason: 'Scheduled service work (event type, inspector, duration, price, status), not a log. It declares onDelete cascade from inspections, so its lifetime already IS the inspection record window; an independent clock here would time-expire live business records. Named in OI #276 by mistake.',
    },
    {
        table: 'automation_logs',
        reason: 'The evidence ledger for what was sent to whom and when — retained indefinitely by design (OI #276 scope note), and the reason the erasure manifest gives automation_logs.recipient a retain rule rather than an erase rule.',
    },

    // ── Bounded by construction, so a clock would add nothing ────────────────
    {
        // CORRECTED 2026-08-07. The previous reason said
        // `detail` is "documented and ENFORCED as a non-sensitive summary" and
        // that the table "cannot grow with time". Both halves were checked
        // against the code and both overstated it:
        //   - Enforcement does not exist. `clampDetail` trims whitespace and
        //     truncates at 300 characters. Nothing inspects the CONTENT, so a
        //     caller that passes a provider response body stores its first 297
        //     characters verbatim. Documented, yes; enforced, no.
        //   - The prune bounds COUNT, not AGE, and storage limitation asks about
        //     age. A target probed once and never again keeps that row forever —
        //     the sixth write that would displace it never happens.
        // The exclusion still stands, on the narrower ground stated below. What
        // changed is that it no longer rests on a guarantee the code does not
        // make. Same species as the two erasure-manifest justifications
        // corrected the same day: the reasoning read well and was not true.
        table: 'integration_test_results',
        reason: 'Bounded to KEEP_PER_TARGET rows per (tenant, target) by an unconditional prune on every write (recordIntegrationTest, server/lib/integration-test-results.ts), so volume cannot grow with usage. The residual is AGE not volume — a target probed once keeps that row indefinitely — and it is accepted because what a retained row holds is a staff user id, a target enum and a provider message clamped to 300 characters about the tenant own integration, not a record of a data subject. Note the clamp is a LENGTH limit: the non-sensitivity of detail is a caller convention, not something this module can enforce.',
    },
    {
        table: 'migration_rows',
        reason: 'Deleted by the migration_batches executor in the same pass, because a staging row has no lifetime of its own — it exists only as part of a run. A second rule here would give one lifetime two clocks, and the two would drift the first time either window moved. Recorded rather than omitted so a reader can tell "governed elsewhere" from "nobody looked".',
    },
    {
        table: 'sms_delivery_status',
        reason: 'A per-message state cell, not an append-only ledger: rows are upserted last-writer-wins by (tenant, provider_message_id). The columns are a provider message id, a normalized status enum and a provider error code — no recipient identifier and no free text. The person the delivery concerns lives on the contact row, under the erasure manifest.',
    },
];

/** @gateConsumed read as source text by `scripts/check-retention-manifest.mjs`. */
export const RETENTION_OPEN: RetentionOpenEntry[] = [
    // `idempotency_keys` and `sync_outbox` were parked here on 2026-08-06 with a
    // 2027-02-06 date. Both were DECIDED on 2026-08-07 and moved to
    // RETENTION_MANIFEST above, each with a window derived from its own
    // mechanics rather than borrowed from a neighbour. Two corrections came out
    // of building them, recorded because both were plausible and both were wrong:
    //   - The 08-06 audit stated `idempotency_keys` "has its own TTL delete at
    //     store.ts:92". It does not. That line is inside the claim-STEAL UPDATE;
    //     the only DELETE in the module is `releaseKey`, which runs solely from a
    //     caught handler exception. Verified in source 2026-08-07.
    //   - The parked reason above said outbox rows go to "sent or failed". The
    //     terminal happy-path status is `published` (`SYNC_OUTBOX_STATUSES`);
    //     `sent` is not a value this column can hold. A predicate written from
    //     that sentence would have matched nothing and read as a working rule.
];
