/**
 * Intent comes from an act, not from an artefact.
 *
 * review review (§26d-2): intent must come from a recorded user action, not
 * be inferred back from the fact that a signature image exists. The chain they
 * asked to see is three steps — the signer was PRESENTED agreement X at
 * version/hash Y, the signer TOOK an explicit signing action, the system
 * RECORDED a signature.
 *
 * ── What was missing ────────────────────────────────────────────────────────
 * Steps two and three were recorded: `signer.signed` carries the envelope's
 * content hash and the signature image hash, and the event's existence IS the
 * action.
 *
 * Step ONE was recorded nowhere. `request.viewed` is declared in the audit event
 * enum and in the audit service's event union, and had **zero writers** —
 * nothing had ever appended one. What did exist was `markViewedBySigner`, which
 * flips a status column: a flag, not a chained tamper-evident fact, and carrying
 * no hash at all. So the chain said "a signature was recorded against this hash"
 * with no record of the signer having been shown it.
 *
 * ── Why this reuses the audit chain instead of a new table ──────────────────
 * review offered two acceptable forms: a dedicated `signing_intent_event`, or
 * "at least ensure the existing signing event explicitly records" the three
 * facts. This is the second, deliberately. `esign_audit_logs` is already
 * hash-chained and signed on every append, which is exactly the property an
 * intent record needs — a parallel table would have to earn that property again,
 * and would create a second answer to "what happened to this envelope".
 *
 * ── Why a missing hash is not a failure ─────────────────────────────────────
 * An envelope whose snapshot predates content hashing has no hash to compare.
 * Refusing there would block a signature for a reason about our own history
 * rather than about the signer. The honest answer is that the hash half cannot
 * be checked — so the PRESENTATION requirement still applies and the comparison
 * is skipped. The weaker check does not become no check.
 */

/**
 * The audit event that records a presentation to ONE signer.
 *
 * Not `request.viewed`, which existed (with zero writers) and looked like the
 * obvious home. That event is ENVELOPE-level under the audit dedup index, which
 * excludes only `signer.%` — so on a two-signer envelope the first viewer's row
 * inserts and the second hits the unique constraint and gets the first signer's
 * row back. The chain would then show a presentation to somebody else, and the
 * second signer's intent would be resting on it. The dedup class is what makes
 * these two different events rather than one event with two readings.
 */
export const PRESENTATION_EVENT = 'signer.presented' as const;

/** The shape this module needs from an `esign_audit_logs` row. */
export interface AuditRowLike {
    event: string;
    payloadJson: string;
}

/**
 * Every content hash THIS signer was shown.
 *
 * Scoped to the signer on purpose: two signers on one envelope is the normal
 * case, and a co-client's view must never satisfy the primary client's chain.
 *
 * A malformed payload is skipped rather than thrown on. These rows are read
 * years later by a verifier, and one unreadable row must not make the whole
 * chain unreadable.
 */
export function presentedContentHashes(
    logs: readonly AuditRowLike[],
    signerId: string,
): Set<string> {
    const out = new Set<string>();
    for (const row of logs) {
        if (row.event !== PRESENTATION_EVENT) continue;
        let payload: { signerId?: unknown; contentHash?: unknown };
        try {
            payload = JSON.parse(row.payloadJson) as typeof payload;
        } catch {
            continue;
        }
        if (payload.signerId !== signerId) continue;
        if (typeof payload.contentHash === 'string' && payload.contentHash !== '') {
            out.add(payload.contentHash);
        } else {
            // Presented, but from before hashing. Recorded as a presentation
            // with no hash — see the header for why that is not a refusal.
            out.add('');
        }
    }
    return out;
}

export interface SigningIntentCheck {
    logs: readonly AuditRowLike[];
    signerId: string;
    /** The hash being signed. Null on an envelope predating content hashing. */
    signedHash: string | null;
}

/**
 * Why this signature's intent chain is broken, or null when it is intact.
 *
 * Returns a REASON rather than a boolean because the two failures are different
 * facts and a caller records which one happened: "never presented" is a missing
 * step, "presented something else" is a document that changed under a signer.
 */
export function signingIntentProblem(check: SigningIntentCheck): string | null {
    const presented = presentedContentHashes(check.logs, check.signerId);
    if (presented.size === 0) {
        return 'no recorded presentation: this signer has no audit event showing '
            + 'the agreement was presented to them, so intent would be inferred '
            + 'from the signature existing rather than from an act';
    }
    // Nothing to compare — the presentation is recorded, the hash is not.
    if (check.signedHash === null || presented.has('')) return null;

    if (!presented.has(check.signedHash)) {
        return 'presented content differs from the content being signed: the '
            + 'signer was shown a document whose hash is not the document this '
            + 'signature is over';
    }
    return null;
}
