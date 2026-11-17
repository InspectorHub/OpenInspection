/**
 * E-1 job token: a short-lived HMAC-SHA256 signed bearer for one data-package
 * job, reusing the signing pattern of `video-upload-token.ts`.
 *
 * Format `{b64url(payload)}.{b64url(HMAC-SHA256(payload, secret))}`. The payload
 * is `JSON({ tenantId, jobId, userId, exp, kind: 'data-job' })`; the `kind`
 * domain-separates it from the video/photo media upload tokens that share the
 * same secret source, so neither can be replayed as the other. The signature
 * covers the base64url payload string, so verification re-signs that exact
 * string rather than re-encoding parsed JSON.
 *
 * The token proves only that its holder recently started/resumed this job for
 * this tenant and user. The route still takes the tenant and user from the
 * verified session and binds them here; the job itself is always re-read
 * scoped by that tenant. Read pages do not need step-up — one elevation at
 * job start must cover an export that lasts hours (plan §2.1/§6).
 */
import { logger } from '../logger';

export interface JobTokenClaims {
    tenantId: string;
    jobId: string;
    userId: string;
}

/** One hour, renewable while the lease is live (plan §2.1). */
export const JOB_TOKEN_TTL_SECONDS = 3600;

const JOB_TOKEN_KIND = 'data-job';

interface JobTokenPayload extends JobTokenClaims {
    exp: number;
    kind: typeof JOB_TOKEN_KIND;
}

function toBase64Url(data: ArrayBuffer | Uint8Array): string {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
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

async function importHmacKey(secret: string): Promise<CryptoKey> {
    return crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign', 'verify'],
    );
}

/** Mint a signed job token valid for `ttlSec` seconds (default one hour). */
export async function signJobToken(
    claims: JobTokenClaims,
    secret: string,
    ttlSec: number = JOB_TOKEN_TTL_SECONDS,
): Promise<string> {
    const payload: JobTokenPayload = {
        tenantId: claims.tenantId,
        jobId: claims.jobId,
        userId: claims.userId,
        kind: JOB_TOKEN_KIND,
        exp: Math.floor(Date.now() / 1000) + ttlSec,
    };
    const payloadStr = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
    const key = await importHmacKey(secret);
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadStr));
    return `${payloadStr}.${toBase64Url(sig)}`;
}

/**
 * Verify a job token. Returns its claims (incl. `exp`) on success, or `null`
 * for any failure (bad signature, expired, malformed, wrong kind, or — when
 * `expected` is given — bound to a different tenant, job or user). One opaque
 * `null` for every failure so a caller cannot distinguish a forged token from
 * an expired or mis-scoped one.
 */
export async function verifyJobToken(
    token: string,
    secret: string,
    expected?: Pick<JobTokenClaims, 'tenantId' | 'jobId' | 'userId'>,
): Promise<(JobTokenClaims & { exp: number }) | null> {
    try {
        const dotIdx = token.lastIndexOf('.');
        if (dotIdx === -1) return null;
        const payloadStr = token.slice(0, dotIdx);
        const sigB64 = token.slice(dotIdx + 1);

        const key = await importHmacKey(secret);
        const sigBytes = fromBase64Url(sigB64).buffer as ArrayBuffer;
        const ok = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(payloadStr));
        if (!ok) return null;

        const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(payloadStr))) as Partial<JobTokenPayload>;
        if (payload.kind !== JOB_TOKEN_KIND) return null;
        if (typeof payload.tenantId !== 'string' || typeof payload.jobId !== 'string' || typeof payload.userId !== 'string') return null;
        if (typeof payload.exp !== 'number' || Math.floor(Date.now() / 1000) > payload.exp) return null;

        if (expected && (
            payload.tenantId !== expected.tenantId
            || payload.jobId !== expected.jobId
            || payload.userId !== expected.userId
        )) return null;

        return { tenantId: payload.tenantId, jobId: payload.jobId, userId: payload.userId, exp: payload.exp };
    } catch (err) {
        logger.error('verifyJobToken: unexpected error', {}, err instanceof Error ? err : new Error(String(err)));
        return null;
    }
}
