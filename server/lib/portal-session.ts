/**
 * Unified client portal — signed magic-link token + session cookie (stateless).
 *
 * Mirrors `observer-cookie.ts` exactly: a self-contained
 * `base64url(JSON body) + '.' + base64url(HMAC-SHA-256 of body64)` envelope.
 * There is NO database row backing either token — they are pure signed
 * payloads, so verification is stateless and revocation relies on short
 * TTLs / re-issuing the session.
 *
 * Secret is `JWT_SECRET`, imported raw as an HMAC key (same as
 * observer-cookie.ts — NOT the m2m-auth HKDF derivation, NOT the JWT keyring).
 *
 * A `typ` discriminator distinguishes the two token families so a magic-link
 * token can never be replayed as a session cookie (or vice versa):
 *   - magic-link  → typ: 'ml'   (short TTL, default 15 min)
 *   - session     → typ: 'sess' (long TTL, default 30 days)
 *
 * All verify functions return `{ email }` only and never throw — any parse,
 * signature, type, or expiry failure yields `null`.
 */
import { timingSafeEqual } from './password';

const encoder = new TextEncoder();

const MAGIC_LINK_TTL_SECONDS = 900;      // 15 minutes
const SESSION_TTL_SECONDS = 2592000;     // 30 days

type PortalTokenType = 'ml' | 'sess';

interface PortalPayload {
    typ:   PortalTokenType;
    email: string;
    exp:   number;   // epoch seconds
}

async function hmacB64(secret: string, msg: string): Promise<string> {
    const key = await crypto.subtle.importKey(
        'raw', encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false, ['sign', 'verify'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(msg));
    return base64Url(new Uint8Array(sig));
}

function base64Url(bytes: Uint8Array): string {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(s: string): string {
    const padded = s + '='.repeat((4 - (s.length % 4)) % 4);
    return atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
}

async function signToken(secret: string, typ: PortalTokenType, email: string, ttlSeconds: number): Promise<string> {
    const payload: PortalPayload = {
        typ,
        email,
        exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    };
    const body64 = base64Url(encoder.encode(JSON.stringify(payload)));
    const sig    = await hmacB64(secret, body64);
    return `${body64}.${sig}`;
}

async function verifyToken(secret: string, expectedTyp: PortalTokenType, token: string): Promise<{ email: string } | null> {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [body64, providedSig] = parts;
    if (!body64 || !providedSig) return null;

    let expectedSig: string;
    try {
        expectedSig = await hmacB64(secret, body64);
    } catch {
        return null;
    }
    if (!timingSafeEqual(providedSig, expectedSig)) return null;

    let payload: PortalPayload;
    try {
        payload = JSON.parse(base64UrlDecode(body64)) as PortalPayload;
    } catch {
        return null;
    }

    if (!payload || typeof payload !== 'object') return null;
    if (payload.typ !== expectedTyp) return null;
    if (typeof payload.email !== 'string' || payload.email.length === 0) return null;
    if (typeof payload.exp !== 'number') return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;

    return { email: payload.email };
}

export function signMagicLink(secret: string, email: string, ttlSeconds: number = MAGIC_LINK_TTL_SECONDS): Promise<string> {
    return signToken(secret, 'ml', email, ttlSeconds);
}

export function verifyMagicLink(secret: string, token: string): Promise<{ email: string } | null> {
    return verifyToken(secret, 'ml', token);
}

export function signPortalSession(secret: string, email: string, ttlSeconds: number = SESSION_TTL_SECONDS): Promise<string> {
    return signToken(secret, 'sess', email, ttlSeconds);
}

export function verifyPortalSession(secret: string, token: string): Promise<{ email: string } | null> {
    return verifyToken(secret, 'sess', token);
}
