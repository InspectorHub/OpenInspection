/**
 * HMAC-SHA256 signed short-lived upload token for R2 video direct uploads.
 *
 * Format: `{base64url(payload)}.{base64url(HMAC-SHA256(payload, key))}`.
 * The payload is `JSON({ tenantId, inspectionId, mediaId, exp })`.
 * The signature covers only the base64url-encoded payload string so that the
 * verification step can re-encode from the parsed JSON and get the same bytes.
 */

import { logger } from './logger';

export interface UploadTokenClaims {
    tenantId: string;
    inspectionId: string;
    mediaId: string;
}

interface TokenPayload extends UploadTokenClaims {
    exp: number;
}

// ── Base64url helpers (no external deps) ─────────────────────────────────────

function toBase64Url(data: ArrayBuffer | Uint8Array): string {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
    const base64 = s.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

// ── Key derivation ────────────────────────────────────────────────────────────

async function importHmacKey(secret: string): Promise<CryptoKey> {
    return crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign', 'verify'],
    );
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Mint a signed upload token valid for `ttlSec` seconds.
 *
 * @param claims    `{ tenantId, inspectionId, mediaId }`
 * @param ttlSec    Lifetime in seconds (900 = 15 min for normal uploads).
 * @param secret    Raw secret string (from env.JWT_SECRET or equivalent).
 * @returns         Opaque token string `{b64urlPayload}.{b64urlSig}`.
 */
export async function signUploadToken(
    claims: UploadTokenClaims,
    ttlSec: number,
    secret: string,
): Promise<string> {
    const payload: TokenPayload = {
        ...claims,
        exp: Math.floor(Date.now() / 1000) + ttlSec,
    };
    const payloadStr = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
    const key = await importHmacKey(secret);
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadStr));
    return `${payloadStr}.${toBase64Url(sig)}`;
}

/**
 * Verify a token produced by `signUploadToken`.
 *
 * Returns the decoded claims (including `exp`) on success, or `null` when the
 * token is invalid (bad signature, expired, or malformed).
 */
export async function verifyUploadToken(
    token: string,
    secret: string,
): Promise<(UploadTokenClaims & { exp: number }) | null> {
    try {
        const dotIdx = token.lastIndexOf('.');
        if (dotIdx === -1) return null;

        const payloadStr = token.slice(0, dotIdx);
        const sigB64 = token.slice(dotIdx + 1);

        // Verify signature using the runtime's constant-time HMAC verify (no length oracle).
        const key = await importHmacKey(secret);
        // Cast through ArrayBuffer to satisfy the strict Uint8Array<ArrayBuffer> type
        // expected by crypto.subtle.verify (tsc strict mode narrows ArrayBufferLike
        // which Uint8Array normally carries, but the runtime accepts any Uint8Array).
        const sigBytes = fromBase64Url(sigB64).buffer as ArrayBuffer;
        const ok = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(payloadStr));
        if (!ok) return null;

        // Decode payload.
        const payload: TokenPayload = JSON.parse(
            new TextDecoder().decode(fromBase64Url(payloadStr)),
        );

        // Expiry check.
        if (Math.floor(Date.now() / 1000) > payload.exp) return null;

        return payload;
    } catch (err) {
        logger.error('verifyUploadToken: unexpected error', {}, err instanceof Error ? err : new Error(String(err)));
        return null;
    }
}
