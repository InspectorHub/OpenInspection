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
        table: 'integration_test_results',
        reason: 'Self-bounded: appendTestResult in server/lib/integration-test-results.ts prunes to the newest KEEP_PER_TARGET rows per (tenant, target) on every write, so the table cannot grow with time. `detail` is documented and enforced as a non-sensitive summary — never a key, token or response body.',
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
    {
        table: 'idempotency_keys',
        reason: 'response_body holds the serialized success response of a mutating API call, replayed verbatim on retry — so it holds whatever PII that endpoint returns. expires_at is NOT a delete clock: it only lets a later claim STEAL the row in place (server/lib/idempotency/store.ts), and releaseKey deletes only on handler failure. A key never re-claimed therefore keeps its response body forever. Found while cataloguing for #276; the window is a decision, not a bug fix, so it is parked rather than guessed.',
        decideBy: '2027-02-06',
    },
    {
        table: 'sync_outbox',
        reason: 'payload is the serialized user-sync CloudEvent, which carries staff email and name. Rows are transitioned to sent or failed and never deleted — the sweeper republishes pending rows and nothing prunes the rest. Structurally the same exposure parked_cmd_events had before #276, one table over.',
        decideBy: '2027-02-06',
    },
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
