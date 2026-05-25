/**
 * Multi-version PORTAL_M2M_SECRET verification helpers.
 *
 * Pairs with the ES256 JWT keyring (src/lib/jwt-keyring.ts) to give the
 * portal -> core machine-to-machine surface the same zero-downtime
 * overlap-window rotation pattern as user JWTs.
 *
 * Architecture:
 *   - Each secret version is held in env as PORTAL_M2M_SECRET_V<N>.
 *   - PORTAL_M2M_CURRENT_KID (e.g. "v1") names the version Portal sends
 *     on outbound calls — but core never reads this; it accepts ANY active
 *     V<N> secret. Portal owns the kid; core just verifies.
 *   - During rotation: provision V<N+1> on both portal and core (overlap
 *     window — portal still sends V<N>, core accepts either). Once both
 *     sides have V<N+1>, flip PORTAL_M2M_CURRENT_KID on portal so it
 *     starts emitting V<N+1>. After the overlap window, delete V<N>.
 *   - Legacy PORTAL_M2M_SECRET stays accepted as a transitional fallback
 *     so the system keeps booting before the first V<N> rotation.
 *
 * All comparisons MUST be timing-safe. We iterate every candidate so an
 * attacker can't time which slot they hit; an early-exit on mismatch would
 * also be timing-safe per-candidate, but iterating-all keeps the total
 * work constant w.r.t. which secret is presented.
 */

import { timingSafeEqual } from './password';

/** Collect every active M2M secret from env. */
function collectM2mSecrets(env: Record<string, string | undefined>): string[] {
    const candidates: string[] = [];

    // Discover all PORTAL_M2M_SECRET_V<N> versions.
    for (const key of Object.keys(env)) {
        if (/^PORTAL_M2M_SECRET_V\d+$/.test(key)) {
            const value = env[key];
            if (value) candidates.push(value);
        }
    }

    // Legacy single-secret fallback. Kept indefinitely during the migration
    // window so existing deployments without V<N> still work; rotation
    // scripts populate V1 from the legacy value, then drop the legacy
    // binding once V<N> is established on both sides.
    if (env['PORTAL_M2M_SECRET']) {
        candidates.push(env['PORTAL_M2M_SECRET'] as string);
    }

    return candidates;
}

/**
 * Verify an `Authorization: Bearer <secret>` header against every active
 * M2M secret. Returns true when the presented secret matches ANY version.
 *
 * Timing-safe: iterates every candidate and reuses `timingSafeEqual` so
 * an attacker cannot learn which slot they hit from response timing.
 */
export function verifyM2mAuth(
    authHeader: string | undefined,
    env: Record<string, string | undefined>,
): boolean {
    if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
    const presented = authHeader.slice('Bearer '.length);
    if (!presented) return false;

    const candidates = collectM2mSecrets(env);
    if (candidates.length === 0) return false;

    // Iterate every candidate (no short-circuit on success) so total work
    // is invariant across which secret is presented. `timingSafeEqual`
    // itself is constant-time for equal-length inputs.
    let matched = false;
    for (const candidate of candidates) {
        if (timingSafeEqual(presented, candidate)) matched = true;
    }
    return matched;
}

/**
 * Verify a `x-portal-signature: <timestamp>.<hex>` HMAC-SHA256 signature
 * against every active M2M secret. Returns true when ANY version yields
 * a matching MAC.
 *
 * This is the rotation-aware counterpart to the inline HMAC verify in
 * src/api/integration.ts. The 5-minute timestamp window is enforced here
 * too so call sites don't have to duplicate the check.
 */
export async function verifyM2mSignature(
    signatureHeader: string | undefined,
    body: string,
    env: Record<string, string | undefined>,
): Promise<boolean> {
    if (!signatureHeader) return false;
    const parts = signatureHeader.split('.');
    if (parts.length !== 2) return false;
    const [timestamp, hash] = parts as [string, string];

    // Replay protection: 5-minute window.
    const tsNum = parseInt(timestamp, 10);
    if (!Number.isFinite(tsNum)) return false;
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - tsNum) > 300) return false;

    const candidates = collectM2mSecrets(env);
    if (candidates.length === 0) return false;

    const encoder = new TextEncoder();
    const data = encoder.encode(`${timestamp}.${body}`);
    const presentedSig = hexToUint8Array(hash);

    let matched = false;
    for (const candidate of candidates) {
        const key = await crypto.subtle.importKey(
            'raw',
            encoder.encode(candidate),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['verify'],
        );
        const ok = await crypto.subtle.verify('HMAC', key, presentedSig, data);
        if (ok) matched = true;
    }
    return matched;
}

function hexToUint8Array(hex: string): Uint8Array<ArrayBuffer> {
    if (hex.length % 2 !== 0) return new Uint8Array(new ArrayBuffer(0));
    const arr = new Uint8Array(new ArrayBuffer(hex.length / 2));
    for (let i = 0; i < arr.length; i++) {
        arr[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
    }
    return arr;
}
