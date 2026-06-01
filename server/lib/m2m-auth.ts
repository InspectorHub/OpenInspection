/**
 * M2M (worker-to-worker) request authentication for the portal ↔ core
 * Service Bindings.
 *
 * WHY THIS EXISTS
 * ---------------
 * Cloudflare does NOT inject any identifying header (there is no `cf-worker`)
 * on a direct Service-Binding `.fetch()` call. Those `cf-*` headers are added
 * by Cloudflare's public edge for internet-facing requests; a binding call
 * never crosses that edge, so the receiver sees no such header. The previous
 * "auth is implicit via the cf-worker header" assumption therefore failed
 * closed (403) on every binding call once SaaS went live. See the integration
 * routes in apps/core (`requireServiceBinding`) and apps/portal
 * (`/api/integration/from-core`).
 *
 * HOW IT WORKS
 * ------------
 * Both apps MUST already hold the IDENTICAL ES256 keyring private key
 * (`JWT_PRIVATE_KEY_V<N>`) — that is a hard requirement for portal-issued JWTs
 * to be verifiable by core and vice-versa. We derive a DEDICATED HMAC key from
 * that shared private-key PEM via HKDF (domain-separated with a fixed label),
 * so there is zero extra configuration and the M2M trust root is automatically
 * the same one the JWT flow already proves is shared. We never reuse the raw
 * signing key directly — HKDF domain separation yields an independent key, and
 * knowing the derived HMAC key reveals nothing about the EC private key.
 *
 * HEADER FORMAT
 * -------------
 *   x-portal-m2m: <unixSeconds>.<hmacSha256Hex>
 * where hmac = HMAC-SHA256(derivedKey, "<unixSeconds>"). Verification enforces
 * a ±MAX_SKEW_SECONDS window to bound replay (binding traffic never touches the
 * public wire, so the only exposure is the integration routes' public hostname,
 * which an attacker cannot sign for without the shared keyring).
 *
 * Keep this file byte-for-byte identical in apps/portal and apps/core.
 */

export const M2M_HEADER = 'x-portal-m2m';
const HKDF_INFO = 'inspectorhub-portal-core-m2m-v1';
const MAX_SKEW_SECONDS = 300;
const enc = new TextEncoder();

/** Strip a PEM envelope to its raw DER bytes (HKDF input keying material). */
function pemBodyBuf(pem: string): ArrayBuffer {
    const b64 = pem
        .replace(/-----BEGIN [A-Z ]+-----/, '')
        .replace(/-----END [A-Z ]+-----/, '')
        .replace(/\s+/g, '');
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
}

/**
 * Collect every provisioned `JWT_PRIVATE_KEY_V<N>` PEM, current kid first.
 * Verification tries each so the handshake survives a rotation window in which
 * the two apps briefly disagree on `JWT_CURRENT_KID`.
 */
function privateKeyPems(env: Record<string, string | undefined>): string[] {
    const pems: string[] = [];
    const seen = new Set<string>();
    const push = (pem?: string) => {
        if (pem && !seen.has(pem)) { seen.add(pem); pems.push(pem); }
    };
    const current = env['JWT_CURRENT_KID'];
    if (current) push(env[`JWT_PRIVATE_KEY_V${current.replace(/^v/i, '')}`]);
    for (const k of Object.keys(env)) {
        if (/^JWT_PRIVATE_KEY_V\d+$/.test(k)) push(env[k]);
    }
    return pems;
}

async function deriveHmacKey(privatePem: string): Promise<CryptoKey> {
    const ikm = await crypto.subtle.importKey('raw', pemBodyBuf(privatePem), 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode(HKDF_INFO) },
        ikm,
        { name: 'HMAC', hash: 'SHA-256', length: 256 },
        false,
        ['sign'],
    );
}

function toHex(buf: ArrayBuffer): string {
    const b = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < b.length; i++) s += (b[i] as number).toString(16).padStart(2, '0');
    return s;
}

/** Constant-time string compare (equal-length hex strings). */
function timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let r = 0;
    for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return r === 0;
}

/** Build the `x-portal-m2m` header value for an outbound binding call. */
export async function signM2mHeader(env: Record<string, string | undefined>): Promise<string> {
    const pems = privateKeyPems(env);
    if (pems.length === 0) throw new Error('M2M: no JWT_PRIVATE_KEY_V<N> in env');
    const ts = Math.floor(Date.now() / 1000).toString();
    const key = await deriveHmacKey(pems[0] as string);
    const mac = await crypto.subtle.sign('HMAC', key, enc.encode(ts));
    return `${ts}.${toHex(mac)}`;
}

/** Verify an inbound `x-portal-m2m` header. True iff signature valid + in-window. */
export async function verifyM2mHeader(
    env: Record<string, string | undefined>,
    headerValue: string | undefined | null,
): Promise<boolean> {
    if (!headerValue) return false;
    const dot = headerValue.indexOf('.');
    if (dot <= 0) return false;
    const ts = headerValue.slice(0, dot);
    const mac = headerValue.slice(dot + 1);
    const tsNum = Number(ts);
    if (!Number.isFinite(tsNum)) return false;
    if (Math.abs(Math.floor(Date.now() / 1000) - tsNum) > MAX_SKEW_SECONDS) return false;
    for (const pem of privateKeyPems(env)) {
        const key = await deriveHmacKey(pem);
        const expected = toHex(await crypto.subtle.sign('HMAC', key, enc.encode(ts)));
        if (timingSafeEqual(expected, mac)) return true;
    }
    return false;
}
