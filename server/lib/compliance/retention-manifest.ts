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
 * ── One constant per number, and the name says what it moves ────────────────
 * An earlier draft had a single `OPERATIONAL_LOG_RETENTION_DAYS` covering every
 * table here. It was withdrawn: storage limitation asks for a period PER
 * PURPOSE, and a dedup ledger and a PII-bearing audit trail are not one
 * purpose. The shared constant was also the shape where editing one value
 * silently moved two unrelated clocks. These numbers are published in the
 * privacy policy, so each one is named after the thing it governs and moving it
 * shows up in the diff as the specific clock it is.
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

/**
 * `audit_logs` anonymization window.
 *
 * Two years covers a dispute cycle plus the annual audit that follows it. Past
 * that, the part of an audit row still worth keeping is the structured event —
 * who-did-what-to-which-entity minus the who.
 */
export const AUDIT_LOG_ANONYMIZE_MONTHS = 24;

/**
 * Deletion window for the replay-protection ledgers
 * (`processed_webhook_events`, `processed_cmd_events`).
 *
 * These only have to outlive a provider or queue retry window, which is
 * measured in hours. Ninety days is a wide margin over the longest documented
 * redelivery schedule, and nothing in the codebase reads a row older than that.
 */
export const DEDUP_LOG_RETENTION_DAYS = 90;

/**
 * Deletion window for the portal to core dead-letter queue
 * (`parked_cmd_events`).
 *
 * Shorter than the dedup ledgers on purpose: a parked row is a signal that two
 * deploys disagree about a command shape, and that is a days-to-weeks
 * diagnosis. A skew nobody noticed in thirty days will not be diagnosed from a
 * row a year later.
 */
export const DEAD_LETTER_RETENTION_DAYS = 30;

/**
 * Deletion window for TERMINAL rows of the core to portal user-sync outbox
 * (`sync_outbox`).
 *
 * Sixty days, and deliberately neither of its neighbours' numbers.
 *
 * SHORTER than the dedup ledgers' ninety. Those rows are an event id and a
 * timestamp; an outbox row carries a serialized user-sync CloudEvent — staff
 * email and name, and for `user.password_changed` the password HASH. A window
 * over identifier-bearing rows should not be copied from a window over rows
 * that hold none.
 *
 * LONGER than the dead-letter queue's thirty. A parked row can only be READ: it
 * is an unparseable command, and diagnosis is all it will ever support. A
 * terminal outbox row is still ACTIONABLE — `retryFailed()` republishes it, and
 * doing so repairs real divergence between portal and core. Deleting it removes
 * the fix, not just the evidence.
 *
 * Why sixty specifically: a portal/core user divergence is not noticed by a
 * monitor, it is noticed by a human reading a seat count or a stale member on a
 * monthly cycle. The row has to survive long enough that a divergence spotted
 * in one cycle can still be re-driven during the next — two cycles, so ~60 days.
 */
export const SYNC_OUTBOX_RETENTION_DAYS = 60;

/**
 * Deletion window for the idempotent-replay store (`idempotency_keys`).
 *
 * ── This is NOT `expires_at`, and the difference is the point ───────────────
 * `expires_at` answers a CONCURRENCY question: may a later caller steal a claim
 * whose holder died? `claimKey` consults it only on an `in_flight` row — the
 * `done` branch returns the stored response ABOVE that check — so a completed
 * row replays forever, years past its own `expires_at`, still holding
 * `response_body`. Two different questions, and only one of them was answered.
 *
 * ── Why seven days ──────────────────────────────────────────────────────────
 * Derived from the horizon the feature itself declares rather than picked. The
 * store's TTL is 24 hours and its schema says a retry older than that "is a
 * different problem". Deleting a `done` row means a later replay of the same
 * key RE-EXECUTES the mutation, so the window must clear any legitimate retry:
 * a week is seven full TTLs of margin, enough for a client re-driving a queued
 * intent after a weekend outage, and short enough that a verbatim API response
 * body — whatever PII that endpoint returned — is not kept for a quarter.
 */
export const IDEMPOTENCY_REPLAY_RETENTION_DAYS = 7;

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
