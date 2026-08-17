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
 * Counsel reviewed the portal's six windows on 2026-08-14 and approved NONE as
 * final — not because a period was unlawful, but because none carried a
 * purpose-based derivation. These fourteen were never put to counsel at all.
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

/** `interim` = running in production, not approved. `approved` = counsel signed off on THIS version. */
export type RetentionPolicyStatus = 'interim' | 'approved';

export interface RetentionPolicyHeader {
    /** `YYYY-MM-DD.N` — N distinguishes multiple revisions on one day. */
    version: string;
    status: RetentionPolicyStatus;
    /** ISO date these rules began deleting production data. */
    effectiveAt: string;
    /**
     * What approved this version — a counsel round document under
     * `docs/legal/` in the superproject, not a person's name. A named approver
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

export const RETENTION_POLICY: RetentionPolicyHeader = {
    version: '2026-08-17.2',
    status: 'interim',
    effectiveAt: '2026-08-08',
    approvedBy: null,
    approvedAt: null,
    supersedes: '2026-08-17.1',
    rulesDigest: '8e1b4cda8812770e388f2cfd3e52190e7c015dc54626ceec82d372c2e8c41090',
};
