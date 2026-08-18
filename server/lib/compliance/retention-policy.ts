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
 * ── Why `interim` is the honest value ───────────────────────────────────────
 * review reviewed the portal's six windows on 2026-08-14 and approved NONE as
 * final — not because a period was unlawful, but because none carried a
 * purpose-based derivation. These fourteen were never put to review at all.
 * `approvedBy` and `approvedAt` stay null until that changes, and the gate does
 * not care whether they are null: it only cares that the rules cannot change
 * without this header changing with them.
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
 *   because review asked for exactly that distinction: "如果这是要直接交给工程团队
 *   执行的 ruling，我建议把 review 标成 APPROVED WITH CONDITIONS，而不是 APPROVED".
 *   A reader who sees `approved` stops asking what is left.
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
     * anchor, action, the RESOLVED window value and its unit, the set of
     * out-of-scope tables, and each open entry's table and decide-by date.
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
 * ⚠️ APPROVED WITH CONDITIONS — review. Five things must be true before this
 * becomes `approved`, and three of them are not:
 *
 *   1. ✅ the manifest matches the ruling (4 windows changed, 2 tables removed)
 *   2. ⚠️ #11/#12 are DECLARED reference-preserving; the dependency-aware sweep
 *         that would retire an unreferenced version does not exist. Out-of-scope
 *         is the safe half — nothing is deleted — but it is not the whole ruling
 *   3. ❌ `legal_hold` overrides every scheduled deletion. ZERO occurrences in the
 *         codebase. review: without it "再漂亮的 36/84 个月数字都会被 litigation
 *         preservation 要求击穿"
 *   4. ❌ the customer ToS re-accept flow names the liability cap in its change
 *         summary (portal)
 *   5. ❌ approval/version registration completed before the new ToS publishes
 *
 * ⚠️ AND A SCOPE LIMIT review asked to be written here rather than filed: this
 * covers DATABASE retention only. Object storage, Durable Objects, KV and queues
 * were never in the compliance register (review). A green retention gate does
 * NOT mean the data lifecycle has been reviewed — "否则以后很容易有人看到
 * retention gate = green 就误以为所有 production stores 都已经被覆盖".
 */
export const RETENTION_POLICY: RetentionPolicyHeader = {
    version: '2026-08-19.1',
    status: 'approved_with_conditions',
    effectiveAt: '2026-08-08',
    approvedBy: '[redacted]',
    approvedAt: '2026-08-19',
    supersedes: '2026-08-17.3',
    rulesDigest: '78ba3976c4d516808a7bccf8626f7bb816fa3628d9eeb5aa0eca508bcc7a5d17',
};
