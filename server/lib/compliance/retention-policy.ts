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
 * review reviewed the portal's six windows on 2026-08-14 and approved NONE as
 * final — not because a period was unlawful, but because none carried a
 * purpose-based derivation. The engine's own windows were not put to review
 * at all until rounds 33 and 34, which is what moved this header off `interim`
 * and set `approvedBy` to a round document.
 *
 * A rule added AFTER that ruling does not inherit it. The status does NOT
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
 * `approved_with_conditions` = review ruled on the windows, and named conditions
 *   that are NOT yet met. Deliberately its own value rather than `approved`,
 *   because a ruling handed straight to an engineering team has to carry its
 *   own unmet conditions, and a reader who sees `approved` stops asking what is
 *   left.
 * `approved` = review signed off on THIS version and every condition is met.
 */
export type RetentionPolicyStatus = 'interim' | 'approved_with_conditions' | 'approved';

export interface RetentionPolicyHeader {
    /** `YYYY-MM-DD.N` — N distinguishes multiple revisions on one day. */
    version: string;
    status: RetentionPolicyStatus;
    /** ISO date these rules began deleting production data. */
    effectiveAt: string;
    /**
     * What approved this version — a review round document under
     * `[redacted]` in the superproject, not a person's name. A named approver
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
 * ⚠️ APPROVED WITH CONDITIONS — rounds 33 and 34. Conditions still unmet:
 *
 *   1. ✅ the manifest matches the rulings (4 windows changed, 2 pending closed)
 *   2. ✅ reference-preserving retention — review WITHDREW the review
 *         instruction to remove the legal-version tables from the sweep, and
 *         confirmed the reference-aware executors we had built instead. The rule
 *         it left behind is narrower and stronger than "legal documents are
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
 *   6. ❌ `migration_batches` — added 2026-08-19, NOT put to review. Rounds 33
 *         and 34 ruled on the seventeen rules that existed then; this one came
 *         after and has had no external review. It is named here rather than
 *         left to be inferred from a date, because `approved_with_conditions`
 *         at the top of this header would otherwise read as covering it. What
 *         needs review specifically: two lifetimes (30 days staged, 90 days
 *         awaiting assistance) sharing one catalogue rule whose declared window
 *         is the longer of them, with the operative clock on a per-row column;
 *         and the fact that what expires is a THIRD PARTY's personal data
 *         uploaded by the operator, not the operator's own.
 *
 * That sixth entry is why the status did not move back to `interim`. Seventeen
 * of eighteen rules genuinely are approved-with-conditions and reverting would
 * destroy the provenance in `approvedBy`; but "approved with conditions" is only
 * honest here because one of the conditions now says which rule is not.
 *
 * ⚠️ AND A METHOD RULE from review, which cost a wasted ruling to learn:
 * do not classify retention behaviour from the manifest or the table name. The
 * EXECUTOR is authoritative evidence of what the sweep actually does. We reported
 * a defect in `sms_disclosure_versions` that its executor had always prevented.
 *
 * ⚠️ AND ONE QUESTION THIS DELIBERATELY DID NOT ANSWER: a hold suspends
 * SCHEDULED deletion, which is what review invariant covers. It does not
 * touch the DSAR erasure path, where a preservation obligation and an erasure
 * request point in opposite directions and the resolution is a legal judgement
 * (GDPR Art. 17(3)(e)) with notification duties attached, not a filter. Wiring
 * it silently either way would have decided that question in a WHERE clause.
 *
 * ⚠️ AND A SCOPE LIMIT review asked to be written here rather than filed: this
 * covers DATABASE retention only. Object storage, Durable Objects, KV and queues
 * were never in the compliance register (review). A green retention gate does
 * NOT mean the data lifecycle has been reviewed — without that sentence here,
 * it is very easy for the next reader to see the gate pass and conclude that
 * every production store is covered.
 */
export const RETENTION_POLICY: RetentionPolicyHeader = {
    version: '2026-08-19.4',
    status: 'approved_with_conditions',
    effectiveAt: '2026-08-08',
    // review remains what approved the seventeen rules it saw. It does NOT
    // cover `migration_batches` — see condition 6 above. `approvedAt` is left at
    // the round-34 date rather than moved forward with this version, because
    // moving it would date an approval to a day nobody approved anything.
    approvedBy: '[redacted]',
    approvedAt: '2026-08-19',
    supersedes: '2026-08-19.3',
    rulesDigest: '3b9fe9d9a5ff55fb86e98e979c3b50922dc35721a87f3ca29681890de83fe631',
};
