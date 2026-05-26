/**
 * Design System 0520 subsystem D phase 4 task 4.2 — observer cookie HMAC.
 *
 * Self-contained `__Host-observer_session` payload: base64url-encoded
 * JSON body + dot-separated HMAC-SHA-256 signature. Used by /observe/:token
 * → set-cookie → /observe/inspections/:id middleware verification.
 *
 * Secret is `JWT_SECRET` (env-supplied; uses Web Crypto, not the JWT
 * keyring which is reserved for actual JWT signing — see apps/core/CLAUDE.md).
 *
 * Constant-time verify is delegated to Web Crypto's HMAC.verify; we
 * compute the expected MAC then perform a byte-level compare. The body
 * itself is non-secret so leaking length is acceptable.
 */
import { timingSafeEqual } from './password';

const encoder = new TextEncoder();

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

export interface ObserverPayload {
    linkId:       string;
    inspectionId: string;
    exp:          number;   // epoch seconds
}

export async function signObserverCookie(payload: ObserverPayload, secret: string): Promise<string> {
    const json = JSON.stringify(payload);
    // Encode body as bytes → base64url so the dot separator is unambiguous.
    const bodyBytes = encoder.encode(json);
    const body64    = base64Url(bodyBytes);
    const sig       = await hmacB64(secret, body64);
    return `${body64}.${sig}`;
}

export async function verifyObserverCookie(cookieValue: string, secret: string): Promise<ObserverPayload | null> {
    if (!cookieValue || typeof cookieValue !== 'string') return null;
    const parts = cookieValue.split('.');
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

    let payload: ObserverPayload;
    try {
        const json = base64UrlDecode(body64);
        payload = JSON.parse(json) as ObserverPayload;
    } catch {
        return null;
    }

    if (!payload || typeof payload !== 'object') return null;
    if (typeof payload.linkId !== 'string' || typeof payload.inspectionId !== 'string' || typeof payload.exp !== 'number') return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
}
