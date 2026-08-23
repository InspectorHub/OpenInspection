/**
 * The signed unsubscribe link that every optional notification email carries.
 *
 * ── What this is for ────────────────────────────────────────────────────────
 * Before this existed, nobody who received mail from a deployment could switch
 * it off from the mail itself. Account holders could, from a signed-in screen;
 * everyone else — the client contacts and partner agents most of the mail
 * actually goes to — could not, and neither could an account holder whose
 * session was being held by a gate. The address that received the message is
 * the only identity such a person has, so the link has to carry it, and it has
 * to carry it in a form nobody can edit.
 *
 * ── Why an endpoint keyed on this token is NOT gate-exempt ──────────────────
 * The route that consumes this (`server/api/unsubscribe.ts`) is mounted under
 * `/api/public`, which `jwtAuthMiddleware` short-circuits BEFORE it classifies
 * the caller. `agentUserId` is therefore never set, and `agentTermsGate`
 * returns on its first line — for the same reason the inbound SMS STOP webhook
 * does. That is worth stating precisely: the endpoint is not on the gate's
 * exempt list and must never be added to it. An exemption is a decision, and a
 * decision can be argued with, revisited, or quietly dropped when the list is
 * tidied. Being outside the gate's reckoning altogether cannot be.
 *
 * ── What the token grants ───────────────────────────────────────────────────
 * Exactly one thing: the right to set ONE cell of ONE recipient's own
 * notification preferences — `(tenant, this address, this class, email)`. It
 * reads nothing, names no id the holder did not already have to know, and
 * cannot reach another address, another notification, or another tenant. The
 * "set" is deliberately two-directional (off, and back on again) because that
 * is still one cell and it is the only way a recipient with no account has back
 * — see `server/api/unsubscribe.ts` for that argument in full.
 *
 * ── No expiry, and what stands in for one ───────────────────────────────────
 * There is none, and that is a choice rather than an omission. An email may be
 * read a year after it was sent, and an unsubscribe link that answers "this has
 * expired" is a promise broken at exactly the moment it is being relied on. The
 * cost is that a leaked token is good indefinitely, and the two things that
 * bound that cost are the narrowness of the grant above and the fact that
 * rotating `JWT_SECRET` invalidates every outstanding link at once.
 *
 * ── Derivation ──────────────────────────────────────────────────────────────
 * HMAC-SHA-256 over a base64url JSON body, keyed on `JWT_SECRET`. Identical in
 * shape to `server/lib/render-token.ts`, deliberately: `JWT_SECRET` is the
 * KDF-input convention in this codebase and is NOT the JWT keyring. Comparison
 * is constant-time. Fail-closed — any defect returns null.
 */
import { timingSafeEqual } from '../password';

const encoder = new TextEncoder();

export interface UnsubscribeGrant {
    tenantId: string;
    /** The address the mail went to. Normalised on both sides — see `normalizeAddress`. */
    email: string;
    /** A `NOTIFICATION_CLASSES` id. One class, never "everything". */
    classId: string;
}

/**
 * The one spelling of an address this system compares.
 *
 * It must match what `buildNotificationPreferences` and the suppression webhook
 * do (`.trim().toLowerCase()`), or a token minted for `Jane@X.com` would
 * resolve to nobody while the mail it rode on reached her perfectly well.
 */
// Not exported: both sides of the token live in this file, and the whole point
// is that mint and verify normalise identically. A second caller normalising
// elsewhere is how the two sides drift.
function normalizeAddress(email: string): string {
    return email.trim().toLowerCase();
}

/** Wire shape. Single letters: this rides in a URL that people paste. */
interface UnsubscribePayload { t: string; e: string; c: string; }

function base64Url(bytes: Uint8Array): string {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(s: string): string {
    const padded = s + '='.repeat((4 - (s.length % 4)) % 4);
    return atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
}

async function hmacB64(secret: string, msg: string): Promise<string> {
    const key = await crypto.subtle.importKey(
        'raw', encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(msg));
    return base64Url(new Uint8Array(sig));
}

export async function signUnsubscribeToken(secret: string, grant: UnsubscribeGrant): Promise<string> {
    const payload: UnsubscribePayload = {
        t: grant.tenantId,
        e: normalizeAddress(grant.email),
        c: grant.classId,
    };
    const body64 = base64Url(encoder.encode(JSON.stringify(payload)));
    return `${body64}.${await hmacB64(secret, body64)}`;
}

/**
 * Verify and decode. Null on ANY defect — a bad shape, a bad signature, a body
 * that is not the JSON this file writes.
 *
 * The signature is checked BEFORE the body is parsed, so nothing an attacker
 * chose is ever handed to `JSON.parse` on the strength of having been sent.
 */
export async function verifyUnsubscribeToken(
    secret: string, token: string,
): Promise<UnsubscribeGrant | null> {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [body64, providedSig] = parts;
    if (!body64 || !providedSig) return null;

    let expectedSig: string;
    try { expectedSig = await hmacB64(secret, body64); } catch { return null; }
    // Constant-time: a byte-at-a-time comparison here would let a caller with a
    // stopwatch recover a signature one character at a time.
    if (!timingSafeEqual(providedSig, expectedSig)) return null;

    let payload: UnsubscribePayload;
    try { payload = JSON.parse(base64UrlDecode(body64)) as UnsubscribePayload; } catch { return null; }
    if (!payload || typeof payload.t !== 'string' || typeof payload.e !== 'string' || typeof payload.c !== 'string') {
        return null;
    }
    if (!payload.t || !payload.e || !payload.c) return null;
    return { tenantId: payload.t, email: payload.e, classId: payload.c };
}

/**
 * Where the link points. One page, one path parameter, no query string — a
 * token in a path segment survives the mail clients that rewrite query strings,
 * and there is nothing else on this URL for a rewriter to lose.
 */
export function unsubscribeUrl(baseUrl: string, token: string): string {
    return `${baseUrl.replace(/\/$/, '')}/unsubscribe/${encodeURIComponent(token)}`;
}
