/**
 * OI #276 — the retention WINDOWS: one constant per clock, and the reason for it.
 *
 * Split out of `retention-manifest.ts` when that file crossed the size gate.
 * The split is along a real seam rather than an arbitrary line count: this file
 * answers HOW LONG and WHY, the manifest answers WHICH TABLES and WHAT ACTION,
 * and `retention-logs.ts` answers HOW. `check-retention-manifest.mjs` reads the
 * manifest's arrays as source text and only ever parses `window.unit`, never the
 * numeric value, so moving the numbers here changes nothing it can see.
 *
 * ── One constant per number, and the name says what it moves ────────────────
 * An earlier draft had a single `OPERATIONAL_LOG_RETENTION_DAYS` covering every
 * table. It was withdrawn: storage limitation asks for a period PER PURPOSE, and
 * a dedup ledger and a PII-bearing audit trail are not one purpose. A shared
 * constant is also the shape in which editing one value silently moves two
 * unrelated clocks. These numbers are published in the privacy policy, so each
 * is named after the thing it governs and moving it shows in the diff as the
 * specific clock it is.
 *
 * The single documented exception is `AI_ASSURANCE_RETENTION_MONTHS`, which two
 * tables share BECAUSE they must never diverge — see the note on it.
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
 * Deletion window for `tenant_destruction_records` — the proof that a
 * workspace's data was destroyed.
 *
 * Three years, and the driver is how long someone can still ASK rather than how
 * long the data is sensitive. The row is non-personal (a tenant id snapshot, a
 * slug, counts), so storage limitation is not pressing on it; what sets the
 * number is the window in which a former customer or their counsel can request
 * the deletion certification an SCC Clause 8.5 obligation promises them. Three
 * years covers the ordinary contractual limitation period and spans at least
 * two annual SOC 2 audit periods, so a purge sampled by an auditor is still
 * evidenced by the report that covers it and by the one after.
 *
 * Reasoning and the instruments behind it: `docs/compliance/destruction-evidence.md`.
 */
export const DESTRUCTION_RECORD_RETENTION_MONTHS = 36;

/**
 * Deletion window for the AI assurance pair — `ai_call_provenance` and
 * `ai_content_reviews`.
 *
 * ONE constant for TWO tables, which this file otherwise forbids. The rule
 * above exists to stop an edit moving two UNRELATED clocks; these two are one
 * purpose split across two tables by normalization, and a review is meaningless
 * without the call it cites. They do not merely happen to share a number — they
 * must never stop sharing one, and a second constant is the shape in which they
 * quietly diverge. `retention-logs.spec.ts` asserts both rules read this.
 *
 * Equal windows are still not sufficient on their own: a review is written
 * AFTER the call it cites, so measured from each row's own timestamp the CALL
 * expires first and leaves the review an orphan for the gap between them. The
 * executor closes that with a predicate — a provenance row with a surviving
 * review does not expire — rather than by fudging the number.
 *
 * Three years matches the destruction record for the same reason: it is the
 * window in which an auditor or a disputing customer can still ask what
 * produced a piece of text and whether anyone checked it.
 */
export const AI_ASSURANCE_RETENTION_MONTHS = 36;

/**
 * Deletion window for `report_versions` — the amendment history behind a
 * published report.
 *
 * Superseded versions only. The CURRENT version of a report is what the report
 * is, and the executor never expires it; what ages out is the trail of earlier
 * drafts and amendments behind it. Three years covers the window in which an
 * amendment is still likely to be questioned.
 */
export const REPORT_VERSION_RETENTION_MONTHS = 36;

/**
 * Deletion window for `sms_disclosure_versions` — the TCPA disclosure text
 * shown at opt-in.
 *
 * ⚠️ In practice this reaps very little, and that is correct rather than a
 * misconfiguration. `sms_consent_log` is RETENTION_OUT_OF_SCOPE — kept
 * indefinitely, because the record IS the tenant's defence against a consent
 * challenge — and every consent row stamps the disclosure version it was shown.
 * Deleting a cited version would leave permanent consent evidence pointing at
 * text that no longer exists, gutting the exact record the exemption protects.
 * So the executor expires only versions NO surviving consent row cites, and
 * never the current one. Published-but-never-shown versions are what actually
 * age out.
 */
export const SMS_DISCLOSURE_RETENTION_MONTHS = 36;

/**
 * Deletion window for `tenant_legal_versions` — the published snapshots of a
 * tenant's own Privacy and Terms text.
 *
 * Superseded versions only, per (tenant, doc): the newest is the live policy
 * behind the hosted `/legal/...` pages and expiring it would blank them. The
 * body is company-authored prose, not personal data (see the erasure manifest's
 * entry for `body_snapshot`), so the period is set by how long a superseded
 * policy is worth being able to produce, not by minimisation.
 */
export const TENANT_LEGAL_VERSION_RETENTION_MONTHS = 36;

/**
 * Deletion window for `tenant_marketplace_import_history`.
 *
 * Display-only history: which library or template version a workspace imported
 * and when. The IMPORT MARKER that the update and replace paths actually read
 * is a different table (`tenant_library_imports`), so expiring a history row
 * shortens a list and cannot change what an import does next.
 */
export const MARKETPLACE_IMPORT_HISTORY_RETENTION_MONTHS = 36;

/**
 * Deletion window for `tenant_slug_history`.
 *
 * Two jobs, and the shorter one is already bounded: `retired_until` blocks
 * reuse of a released slug for `SLUG_RETIREMENT_MS` (one year). The longer job
 * is answering "who did THIS slug belong to" for a link or an email that
 * predates a rename, and three years is comfortably past the one-year block —
 * the window can never expire a row still holding a slug out of circulation.
 */
export const SLUG_HISTORY_RETENTION_MONTHS = 36;

/**
 * Default deletion window for `report_pdfs`, in months.
 *
 * The PLATFORM default for the tenant-silent case, and each tenant may set
 * their own (`tenant_configs.report_pdf_retention_years`, where 0 means
 * indefinite). Expressed in months because the executor does calendar
 * arithmetic for months and multiplying years by 365 drifts against both the
 * calendar and the number published in the disclosure.
 *
 * Seven years is NOT a statutory period and must never be described as one —
 * counsel struck the "five plus two" derivation this number used to carry
 * (round 24, ruling 24A). The wording a customer sees, and the machine-readable
 * taxonomy that keeps the distinction from resting on prose, live in
 * `report-pdf-retention.ts`.
 */
export const REPORT_PDF_DEFAULT_RETENTION_MONTHS = 84;
