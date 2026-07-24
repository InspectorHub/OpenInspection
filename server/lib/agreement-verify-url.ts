/**
 * Canonical builder for the human-readable, permanent envelope verification page
 * (`/verify/:envelopeId`) — the tamper-evident receipt a signer can reference at
 * any time. This is the PAGE surface, never the JSON API (`/api/public/verify/*`)
 * that renders no UI.
 *
 * Kept in one place because the same URL is minted in two independent effect
 * paths (the synchronous sign-effects confirmation email and the async
 * sign-completion workflow's evidence-pack email); letting them drift is how one
 * side ends up mailing a raw JSON endpoint instead of the verify page.
 */

/** Relative path to the envelope verify page (client-safe, host-agnostic). */
export function envelopeVerifyPath(envelopeId: string): string {
    return `/verify/${envelopeId}`;
}

/**
 * Absolute verify-page URL for emails. Falls back to the relative path when no
 * base URL is resolvable (same posture as the callers before extraction).
 */
export function envelopeVerifyUrl(baseUrl: string | null | undefined, envelopeId: string): string {
    const base = (baseUrl || '').replace(/\/$/, '');
    return base ? `${base}${envelopeVerifyPath(envelopeId)}` : envelopeVerifyPath(envelopeId);
}
