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
 * WHICH TABLES and WHAT ACTION.
 *
 * ── Anonymize means the actor does not survive ──────────────────────────────
 * `anonymize` on this list is the same verb the erasure orchestrator uses, and
 * it has to keep meaning the same thing: the structured event survives, the
 * identifiers do not — including free text. A rule that scrubbed identifier
 * columns and left prose behind would claim a legal outcome it does not
 * deliver. The column sets come from the shared `anonymize-pii.ts` module for
 * exactly that reason (see `retention-logs.ts`).
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
    TENANT_LEGAL_VERSION_RETENTION_MONTHS,
    MARKETPLACE_IMPORT_HISTORY_RETENTION_MONTHS,
    SLUG_HISTORY_RETENTION_MONTHS,
} from './retention-windows';


/**
 * A retention period, carrying its unit.
 *
 * Months are not days. A 24-month window expressed as 730 days drifts against
 * the calendar and against the number published in the privacy policy, so the
 * unit travels with the value and the executor does calendar arithmetic for
 * months (`subtractMonthsMs`) rather than multiplying.
 */
export type RetentionWindow =
    | { unit: 'months'; value: number }
    | { unit: 'days'; value: number };

/**
 * One table, one clock.
 *
 * `purpose` is REQUIRED and is not decoration: a period with no stated purpose
 * is a number somebody picked, and the gate rejects it. It is also what makes a
 * later change reviewable — a diff that shortens a window and leaves the
 * purpose untouched is visibly one of the two things wrong.
 */
export interface RetentionRule {
    /** DB table name (snake_case), as it appears in the Drizzle schema. */
    table: string;
    /** The column the window is measured from (snake_case). */
    timestampColumn: string;
    window: RetentionWindow;
    action: 'delete' | 'anonymize';
    /** Why THIS period for THIS table. Enforced non-empty by the gate. */
    purpose: string;
}

export const RETENTION_MANIFEST: RetentionRule[] = [
    {
        table: 'audit_logs',
        timestampColumn: 'created_at',
        window: { unit: 'months', value: AUDIT_LOG_ANONYMIZE_MONTHS },
        action: 'anonymize',
        purpose: 'PII-bearing audit trail. Two years covers a dispute cycle plus the audit that follows it; past that the structured event (action, entity_type, entity_id) is the only part worth keeping, so the actor and the free-text metadata go and the row stays.',
    },
    {
        table: 'processed_webhook_events',
        timestampColumn: 'received_at',
        window: { unit: 'days', value: DEDUP_LOG_RETENTION_DAYS },
        action: 'delete',
        purpose: 'Replay-protection ledger for inbound provider webhooks. It only has to outlive a provider retry window, measured in hours; nothing reads a row older than the window.',
    },
    {
        // NOT `received_at` — the column on this table is `processed_at`. The
        // two dedup ledgers were written months apart and never converged.
        table: 'processed_cmd_events',
        timestampColumn: 'processed_at',
        window: { unit: 'days', value: DEDUP_LOG_RETENTION_DAYS },
        action: 'delete',
        purpose: 'Replay-protection ledger for the portal to core command seam. Same purpose and same retry horizon as the webhook ledger, so deliberately the same number.',
    },
    {
        table: 'parked_cmd_events',
        timestampColumn: 'received_at',
        window: { unit: 'days', value: DEAD_LETTER_RETENTION_DAYS },
        action: 'delete',
        purpose: 'Dead-letter queue, not a log. Its whole job is telling a human that portal and core disagree about a command shape, which is a days-to-weeks activity.',
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
    },
    {
        table: 'idempotency_keys',
        timestampColumn: 'created_at',
        window: { unit: 'days', value: IDEMPOTENCY_REPLAY_RETENTION_DAYS },
        action: 'delete',
        purpose: 'response_body is the verbatim success payload of a mutating API call, so it holds whatever PII that endpoint returned. Measured from created_at, NOT expires_at: that column decides whether a later caller may steal a dead claim and is never read once the row is done, so a completed row outlives it indefinitely. Seven days is seven times the store own declared 24h TTL — margin for a client re-driving a queued intent after a weekend, well inside the horizon past which the store itself says a retry is a different problem.',
    },
    {
        table: 'tenant_destruction_records',
        timestampColumn: 'destroyed_at',
        window: { unit: 'months', value: DESTRUCTION_RECORD_RETENTION_MONTHS },
        action: 'delete',
        purpose: 'The certification that a workspace was destroyed. Non-personal (tenant id snapshot, slug, counts), so the period is set by how long someone can still ask for it rather than by storage limitation: three years covers the ordinary contractual limitation window for an SCC Clause 8.5 request and spans two annual SOC 2 audit periods. Only COMPLETED records expire — a row still reading started is an unfinished destruction, and deleting one closes an open anomaly instead of retiring a settled record. Measured from destroyed_at, the initiation time, which is the only timestamp an unfinished row has.',
    },
    {
        table: 'ai_call_provenance',
        timestampColumn: 'created_at',
        window: { unit: 'months', value: AI_ASSURANCE_RETENTION_MONTHS },
        action: 'delete',
        purpose: 'Which prompt version and model produced a piece of assisted text. Non-personal by construction — the schema forbids prompt text — and it grows per AI call, so it needs a window rather than an exemption. Three years is the same clock as the reviews that cite it, and it MUST stay the same clock: they are one governance record split across two tables. A row a surviving review still cites does not expire, because a review is written after its call and would otherwise outlive it and read as an orphan citation.',
    },
    {
        table: 'ai_content_reviews',
        timestampColumn: 'reviewed_at',
        window: { unit: 'months', value: AI_ASSURANCE_RETENTION_MONTHS },
        action: 'delete',
        purpose: 'That a named person reviewed the output of one AI call before it was published. Shares its clock with ai_call_provenance for the reason stated there. Three years covers the window in which a disputing customer or an auditor can still ask whether anyone checked a piece of assisted text.',
    },
    {
        table: 'report_versions',
        timestampColumn: 'created_at',
        window: { unit: 'months', value: REPORT_VERSION_RETENTION_MONTHS },
        action: 'delete',
        purpose: 'The amendment trail behind a published report. SUPERSEDED versions only: the highest version_number for a report is what the report currently IS, carries its signature and content hash, and never expires here. What ages out is the earlier drafts and amendments behind it, three years past the point anyone is likely to question a revision.',
    },
    {
        table: 'sms_disclosure_versions',
        timestampColumn: 'published_at',
        window: { unit: 'months', value: SMS_DISCLOSURE_RETENTION_MONTHS },
        action: 'delete',
        purpose: 'The TCPA disclosure text shown at SMS opt-in. Expires only versions that NO surviving consent row cites, and never the current (highest) version. sms_consent_log is kept indefinitely by an explicit exemption because that record is the tenant defence against a consent challenge, and every consent row stamps the version it was shown — deleting a cited version would leave permanent evidence pointing at text that no longer exists. In practice this reaps only versions published and never used.',
    },
    {
        table: 'tenant_legal_versions',
        timestampColumn: 'published_at',
        window: { unit: 'months', value: TENANT_LEGAL_VERSION_RETENTION_MONTHS },
        action: 'delete',
        purpose: 'Published snapshots of a tenant own Privacy and Terms text. SUPERSEDED versions only, per tenant and doc: the newest is the live policy the hosted legal pages render, and expiring it would blank them. The body is company-authored prose rather than personal data, so three years is set by how long a superseded policy is worth producing on request.',
    },
    {
        table: 'tenant_marketplace_import_history',
        timestampColumn: 'created_at',
        window: { unit: 'months', value: MARKETPLACE_IMPORT_HISTORY_RETENTION_MONTHS },
        action: 'delete',
        purpose: 'Display-only record of which catalogue version a workspace imported and when. The marker the update and replace paths actually read is tenant_library_imports, a different table, so expiring a history row shortens a list and cannot change what the next import does.',
    },
    {
        table: 'tenant_slug_history',
        timestampColumn: 'changed_at',
        window: { unit: 'months', value: SLUG_HISTORY_RETENTION_MONTHS },
        action: 'delete',
        purpose: 'Who a released slug used to belong to, and a one-year block on reusing it. Three years is comfortably past that block (SLUG_RETIREMENT_MS), so the sweep can never release a slug early; what it retires is the lookup that answers a stale link long after anyone follows one. A row whose retired_until has not passed is kept regardless of age.',
    },
];

/**
 * A table the retention catalogue deliberately does NOT expire, with the reason.
 *
 * @gateConsumed `scripts/check-retention-manifest.mjs` reads this declaration
 * out of the SOURCE TEXT rather than importing it — the gate is a plain .mjs
 * script and this is TypeScript. That consumption is invisible to a
 * module-graph analyzer, so knip would report the symbol as dead. The tag says
 * "a tool consumes this", which is true; a dead-code baseline entry would have
 * said "this is dead and we tolerate it", which is not.
 */
export interface RetentionOutOfScopeEntry {
    table: string;
    reason: string;
}

/** @gateConsumed read as source text by `scripts/check-retention-manifest.mjs`. */
export const RETENTION_OUT_OF_SCOPE: RetentionOutOfScopeEntry[] = [
    // ── Legally-required evidence ────────────────────────────────────────────
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
        // CORRECTED 2026-08-07 (external counsel P1). The previous reason said
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
        table: 'sms_delivery_status',
        reason: 'A per-message state cell, not an append-only ledger: rows are upserted last-writer-wins by (tenant, provider_message_id). The columns are a provider message id, a normalized status enum and a provider error code — no recipient identifier and no free text. The person the delivery concerns lives on the contact row, under the erasure manifest.',
    },
];

/**
 * A table with a KNOWN retention gap and no decision yet, bounded by a date.
 *
 * The shape is borrowed from `PENDING_ENFORCEMENT` in the erasure gate, and for
 * the same reason: the alternative to declaring an open question is writing a
 * reason that sounds like a decision, and out-of-scope is where that lands. An
 * entry here says "this table accumulates data nothing expires, we know, and
 * here is when we answer" — which is honest, visible in the diff, and cannot
 * quietly become permanent because the gate fails once `decideBy` passes.
 *
 * To remove an entry: decide, then move it to `RETENTION_MANIFEST` or
 * `RETENTION_OUT_OF_SCOPE`. Adding one is a reviewed diff, not a keyword.
 *
 * @gateConsumed read as source text by `scripts/check-retention-manifest.mjs`.
 */
export interface RetentionOpenEntry {
    table: string;
    reason: string;
    /** YYYY-MM-DD. The gate fails once this date is past. */
    decideBy: string;
}

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
    {
        table: 'notifications',
        reason: 'The notice header: per-recipient title and body composed about an inspection, addressed to a contact or a staff user. inspection_id is a soft reference with no cascade, so Track A (a row dies with its inspection) does not actually reach it, and read_at / archived_at retire a row from the inbox without removing it. Deciding this needs the notice lifetime answered, not a number picked here.',
        decideBy: '2027-02-06',
    },
    {
        table: 'qbo_sync_errors',
        reason: 'error_msg is the QuickBooks rejection text for one of the tenant own records and may quote a customer name. Rows are deduped per (entity, error code) and resolved in place, so the table is bounded by distinct failures rather than by event volume — but a resolved row is never removed. Whether a resolved sync error is operational scrap or accounting evidence is the open question.',
        decideBy: '2027-02-06',
    },
];
