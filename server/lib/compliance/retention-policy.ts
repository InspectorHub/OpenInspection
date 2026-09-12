/**
 * The retention POLICY header — whose decision the windows are, and whether
 * anyone approved them.
 *
 * NOTHING IMPORTS THIS, AND THAT IS THE DESIGN. Its reader is
 * `scripts/check-retention-policy.mjs`, which opens it BY PATH and parses the
 * text — so the link is invisible to any tool that follows imports, and knip
 * lists this file as an entry point for exactly that reason. If a dead-code
 * sweep ever proposes deleting it, the sweep is wrong: the gate that verifies
 * the digest would then have nothing to verify, and fourteen retention windows
 * would go back to deleting production rows under nobody's signature.
 *
 * `retention-manifest.ts` says which tables expire and `retention-windows.ts`
 * says after how long. Neither says who decided, when it took effect, or
 * whether it has been reviewed — so nothing in this repository could record
 * that fourteen windows have been deleting production rows daily since
 * 2026-08-08 under nobody's signature. A period with no approval field cannot
 * state that it is unapproved.
 *
 * It lives in SOURCE, not in a table. The thing that actually deletes rows is
 * the TypeScript array next door; a policy row in D1 would be a second source
 * of truth able to drift from the code doing the deleting, and the drifting
 * copy is the one an auditor would be shown. Git is the version control that
 * was asked for.
 *
 * ── How the status got where it is ─────────────────────────────
 * This section was headed "Why `interim` is the honest value" and said
 * `approvedBy` and `approvedAt` stay null. That stopped being true at `.2` and
 * the prose did not follow, so the file argued with its own header for two
 * versions. Rewritten rather than deleted, because the reasoning still governs
 * anything added from here.
 *
 * A review of the portal's six windows on 2026-08-14 approved NONE as final —
 * not because a period was unlawful, but because none carried a purpose-based
 * derivation. The engine's own windows were not reviewed at all until later,
 * which is what moved this header off `interim` and gave `approvedBy` a
 * document to point at.
 *
 * A rule added AFTER that review does not inherit it. The status does NOT
 * regress to `interim` when one arrives — that would misdescribe the seventeen
 * that were reviewed — it gains a numbered condition naming the new rule and
 * what about it still needs review. See condition 6.
 *
 * The gate does not care what any of these fields say: it only cares that the
 * rules cannot change without this header changing with them.
 *
 * ── The engine-specific hazard the ratchet has to survive ───────────────────
 * The portal's rules carry literal windows (`'P30D'`), so hashing the manifest
 * source text catches every change to them. This repository's rules carry
 * CONSTANT REFERENCES — `{ unit: 'months', value: AUDIT_LOG_ANONYMIZE_MONTHS }`
 * — and the number lives in a different file. A digest over the manifest text
 * alone would not move when `AUDIT_LOG_ANONYMIZE_MONTHS` goes from 24 to 12,
 * which is precisely the edit this header exists to make visible. So
 * `scripts/check-retention-policy.mjs` resolves every constant through
 * `retention-windows.ts` and hashes the RESOLVED NUMBER, and refuses to hash a
 * name it cannot resolve rather than hashing the name and reading green.
 */

/**
 * `interim` = running in production, not approved.
 * `approved_with_conditions` = the windows were reviewed, and conditions were
 *   named that are NOT yet met. Deliberately its own value rather than
 *   `approved`, because an approval handed straight to an engineering team has
 *   to carry its own unmet conditions, and a reader who sees `approved` stops
 *   asking what is left.
 * `approved` = THIS version is signed off and every condition is met.
 */
export type RetentionPolicyStatus = 'interim' | 'approved_with_conditions' | 'approved';

export interface RetentionPolicyHeader {
    /** `YYYY-MM-DD.N` — N distinguishes multiple revisions on one day. */
    version: string;
    status: RetentionPolicyStatus;
    /** ISO date these rules began deleting production data. */
    effectiveAt: string;
    /**
     * What approved this version — a review document rather than a person's
     * name. A named approver
     * goes stale when they leave; the document keeps the reasoning attached to
     * the decision and can be read years later by someone who never met them.
     */
    approvedBy: string | null;
    approvedAt: string | null;
    /** The version this replaced, or null for the first versioned policy. */
    supersedes: string | null;
    /**
     * SHA-256 over the OPERATIVE fields of all three retention arrays — table,
     * anchor, action, `legalHold`, the RESOLVED window value and its unit, the
     * set of out-of-scope tables, and each open entry's table and decide-by
     * date.
     * Recomputed by `scripts/check-retention-policy.mjs`; a mismatch fails the
     * build.
     *
     * Deliberately NOT over the `purpose` or `reason` prose. Rewording a
     * justification should not force a version bump, or the bump becomes a
     * reflex and stops meaning anything. What must never move silently is what
     * production deletes and when.
     *
     * `decideBy` IS operative even though it deletes nothing: it is the date
     * this repository promised to answer an open question, and pushing it out
     * is a policy decision wearing a one-character diff.
     */
    rulesDigest: string;
}

/**
 * ⚠️ APPROVED WITH CONDITIONS. Conditions still unmet:
 *
 *   1. ✅ the manifest matches the rulings (4 windows changed, 2 pending closed)
 *   2. ✅ reference-preserving retention — an earlier instruction to remove the
 *         legal-version tables from the sweep was WITHDRAWN, and the
 *         reference-aware executors we had built instead were confirmed. The
 *         rule left behind is narrower and stronger than "legal documents are
 *         exempt": they are protected only while a surviving record needs the
 *         version to remain reproducible
 *   3. ✅ `legal_hold` overrides every scheduled deletion. Every rule now carries
 *         a `legalHold` classification, twelve of them enforced by a tenant
 *         filter the executors apply and two by the driver standing the rule
 *         down entirely; `legal-hold-sweep.spec.ts` drives a held and an unheld
 *         tenant through the real sweep for each of the twelve. What is NOT
 *         covered: a hold is placed by writing the row, with no endpoint and no
 *         screen behind it — deliberate for a rare, legally-directed event, and
 *         stated here rather than left to be discovered
 *   4. ❌ the customer ToS re-accept flow names the liability cap in its change
 *         summary (portal — built, pending the ToS publish)
 *   5. ❌ approval/version registration completed before the new ToS publishes
 *   6. ❌ `migration_batches` — added 2026-08-19, NOT REVIEWED. The review
 *         covered the seventeen rules that existed then; this one came
 *         after and has had no external review. It is named here rather than
 *         left to be inferred from a date, because `approved_with_conditions`
 *         at the top of this header would otherwise read as covering it. What
 *         needs review specifically: two lifetimes (30 days staged, 90 days
 *         awaiting assistance) sharing one catalogue rule whose declared window
 *         is the longer of them, with the operative clock on a per-row column;
 *         the fact that what expires is a THIRD PARTY's personal data uploaded
 *         by the operator, not the operator's own; and — new at `.5` — that the
 *         rule's action is `erase_in_place` rather than `delete`, so the RUN'S
 *         RECORD SURVIVES its own expiry indefinitely. The surviving row holds
 *         ids, timestamps, a vendor name, two authorisations given by the
 *         operator's own people, and — corrected at `.8`, this said "no
 *         third-party data" and that was not accurate — the bundle manifest,
 *         whose adapter warnings quote a canned comment's name and up to forty
 *         characters of its body. The reasoning for keeping the row is that a
 *         cleared run must be distinguishable from one that never happened.
 *         ⚠️ AN IN-HOUSE REVIEW DOES NOT CLOSE THIS CONDITION, however
 *         carefully it is conducted and whatever standard it holds itself to.
 *         What this entry asks for is a review by someone outside, and only
 *         that can discharge it. A later internal assessment may well settle
 *         the engineering defects and still leave this open — when that
 *         happens, do not read the settled defects as the review.
 *   7. ❌ **the surviving `migration_batches` row has no period of its own.**
 *         This is what `.5` recorded as an open question — "whether an
 *         indefinitely-retained record of a data subject's file having been
 *         uploaded is itself in scope" — and the answer taken at `.8` is YES
 *         where the record can relate to identifiable individuals. Being an
 *         audit record does not by itself put a row outside a retention
 *         requirement, even when the row names no data subject, because the
 *         workspace can relate it to a real run.
 *         What that does NOT settle is the NUMBER. The facts available do not
 *         support one, and it is not a figure engineering may pick: a period
 *         here has to be chosen against accountability, contract and
 *         limitation needs. So the SHAPE is settled and the period is not —
 *         keep batch id, tenant, timestamp, vendor, action, authorisation
 *         evidence and outcome, and nothing else, under a period somebody with
 *         those facts decides.
 *         ⚠️ This is the one open item nobody can close by writing code, and it
 *         is NOT expressible as a RETENTION_OPEN entry: `migration_batches`
 *         already carries a rule, and the manifest gate requires a table to
 *         appear in exactly one array. So there is no dated deadline behind it
 *         and no gate that will go red on its own. This list is the only thing
 *         tracking it.
 *
 * Entries 6 and 7 are why the status did not move back to `interim`. Seventeen
 * of nineteen rules genuinely are approved-with-conditions and reverting would
 * destroy the provenance in `approvedBy`; but "approved with conditions" is only
 * honest here because one of the conditions now says which rule is not.
 *
 * ⚠️ WHAT `.8` CHANGED, AND WHY THE DIGEST DID NOT MOVE WITH IT.
 * Two defects were found by reading the executors against the catalogue, and
 * both are fixed at this version:
 *   - apply reset `expires_at` with nothing above it, so an assisted run
 *     applied late reached day 119 under a rule declaring 90. `appliedExpiry`
 *     now clamps the reset to the run's own creation plus the declared window.
 *   - `report_translations` survived the deletion of its own report, because
 *     the inspection cascade derives its child set from `inspection_id` and
 *     that table is keyed by `report_id`. The cascade now handles it.
 * The first of those CHANGED WHAT PRODUCTION DELETES and moved nothing in the
 * digest, because the clamp lives in a service and the digest covers the
 * catalogue. That is the same hazard this header already records about constant
 * references, one layer further out: the digest is a ratchet on the RULES, and
 * it is not evidence that the behaviour they describe is unchanged. Both fixes
 * are held by tests instead, which is the only place that guarantee can live.
 *
 * ⚠️ AND A METHOD RULE, which cost a wasted review cycle to learn:
 * do not classify retention behaviour from the manifest or the table name. The
 * EXECUTOR is authoritative evidence of what the sweep actually does. We reported
 * a defect in `sms_disclosure_versions` that its executor had always prevented.
 *
 * ⚠️ AND ONE QUESTION THIS DELIBERATELY DID NOT ANSWER: a hold suspends
 * SCHEDULED deletion, which is what the legal-hold invariant covers. It does not
 * touch the DSAR erasure path, where a preservation obligation and an erasure
 * request point in opposite directions and the resolution is a legal judgement
 * (GDPR Art. 17(3)(e)) with notification duties attached, not a filter. Wiring
 * it silently either way would have decided that question in a WHERE clause.
 *
 * ⚠️ AND A SCOPE LIMIT, written here rather than filed away: this
 * covers DATABASE retention only. Object storage, Durable Objects, KV and queues
 * were never in the compliance register. A green retention gate does
 * NOT mean the data lifecycle has been reviewed — without that sentence here,
 * it is very easy for the next reader to see the gate pass and conclude that
 * every production store is covered.
 */
export const RETENTION_POLICY: RetentionPolicyHeader = {
    version: '2026-09-11.8',
    status: 'approved_with_conditions',
    effectiveAt: '2026-08-08',
    // The document named below remains what approved the seventeen rules it
    // saw. It does NOT cover `migration_batches` — see condition 6 above.
    // `approvedAt` is left at its own date rather than moved forward, because
    // moving it would date an approval to a day nobody approved anything, and
    // `.5` changed only the unreviewed rule, and `.6` adds no rule at all: it
    // records `statutory_form_versions` as OUT OF SCOPE. Nothing production
    // deletes has changed — the digest moved because it covers the exclusions
    // too, which is the point of covering them. Moving `approvedBy` for an
    // exclusion would claim a review of a deletion period that never happened.
    approvedBy: 'external-review-2026-08-19',
    approvedAt: '2026-08-19',
    // `.7` adds `report_translations`, and unlike `.6` this one DOES change what
    // production deletes: a stored courtesy translation is a derived copy of
    // report text, and it now has a period of its own rather than inheriting
    // one by accident. `approvedBy`/`approvedAt` still do not move, for the
    // reason given above — the external review saw seventeen rules and this is
    // not one of them. **A reviewer reading this header must be able to tell
    // which rules were approved from which were added afterwards, and the
    // version suffix is the only thing carrying that.**
    //
    // `.8` carries two executor fixes and the two conditions still open.
    // `approvedBy`/`approvedAt` do not move here either, and for a sharper
    // reason than the ones above: the assessment behind `.8` was conducted
    // INTERNALLY and never went out. Moving the approver onto it would convert
    // "we held ourselves to that standard" into "an outside reviewer signed
    // this", which is the one thing this field must never be able to say.
    //
    // ⚠️ The value is deliberately an opaque identifier rather than a filename.
    // What it names is held outside this repository, which is a PUBLIC one, and
    // the mapping from the identifier to the document belongs wherever that
    // document is kept. A reader here should be able to tell that a review
    // happened and on what date, and no more than that.
    supersedes: '2026-08-19.7',
    rulesDigest: '0d782dbd0e8afe1790a6d53b4d07819f5dfa83884e6ba1837c4b652bb737f892',
};
