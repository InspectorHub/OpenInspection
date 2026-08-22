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
 *   x-portal-m2m: <unixSeconds>.<actorBase64Url>.<hmacSha256Hex>
 * where hmac = HMAC-SHA256(derivedKey, <everything before the final segment>).
 * Verification enforces a ±MAX_SKEW_SECONDS window to bound replay (binding
 * traffic never touches the public wire, so the only exposure is the integration
 * routes' public hostname, which an attacker cannot sign for without the shared
 * keyring).
 *
 * THE ACTOR IS INSIDE THE SIGNATURE
 * ---------------------------------
 * The second form names the person at the deployment operator behind the call,
 * and it is the field an audit row's "the platform did this" now rests on. A
 * separate header would be a claim anyone able to reach the integration hostname
 * could make. Because it sits under the same MAC, an actor cannot be edited,
 * attached to an unattributed call, or stripped from an attributed one.
 *
 * A call with NO actor produces the two-segment form BYTE-FOR-BYTE as before.
 * That is not politeness towards old code: the two apps deploy independently, so
 * for one contract window a new signer talks to an old verifier. Nearly every
 * call across this seam has no acting person (provisioning, seat reconciliation,
 * a queue consumer), and all of them must cross that window untouched.
 *
 * Keep this file byte-for-byte identical in apps/portal and apps/core.
 */

export const M2M_HEADER = 'x-portal-m2m';

/**
 * The person at the deployment operator behind a seam call, when there is one.
 *
 * Most calls across this seam have no acting person at all — provisioning, seat
 * reconciliation, a queue consumer — and that is not a deficiency to be fixed
 * with a placeholder. `null` means "nobody"; it must never be spelled as a
 * synthetic actor, because a synthetic actor is indistinguishable from a real
 * one in the audit trail this exists to create.
 *
 * `platformAdminId` is the durable identifier and is what gets recorded.
 * `email` travels for display only.
 */
export interface PlatformActor {
    platformAdminId: string;
    email: string;
}

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

const dec = new TextDecoder();

function b64urlEncode(bytes: Uint8Array): string {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i] as number);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Null rather than a throw: a malformed segment is an untrusted input, not a bug. */
function b64urlDecode(segment: string): Uint8Array | null {
    if (!/^[A-Za-z0-9_-]+$/.test(segment)) return null;
    try {
        const bin = atob(segment.replace(/-/g, '+').replace(/_/g, '/'));
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    } catch { return null; }
}

/**
 * Read an actor segment back. Fails closed on anything that is not exactly the
 * two string fields — a half-shaped actor would reach the audit trail as a named
 * person whose name is `undefined`.
 */
function decodeActor(segment: string): PlatformActor | null {
    const bytes = b64urlDecode(segment);
    if (!bytes) return null;
    let parsed: unknown;
    try { parsed = JSON.parse(dec.decode(bytes)); } catch { return null; }
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { platformAdminId, email } = parsed as Record<string, unknown>;
    if (typeof platformAdminId !== 'string' || platformAdminId.length === 0) return null;
    if (typeof email !== 'string' || email.length === 0) return null;
    return { platformAdminId, email };
}

/** What a verified inbound header turned out to be. */
export interface M2mVerification {
    ok: boolean;
    /** Non-null only when `ok` and the signed header actually carried an actor. */
    actor: PlatformActor | null;
}

/**
 * Build the `x-portal-m2m` header value for an outbound binding call.
 *
 * With no actor this is the two-segment form, unchanged. With one, the actor is
 * a middle segment and the MAC covers it.
 */
export async function signM2mHeader(
    env: Record<string, string | undefined>,
    actor?: PlatformActor | null,
): Promise<string> {
    const pems = privateKeyPems(env);
    if (pems.length === 0) throw new Error('M2M: no JWT_PRIVATE_KEY_V<N> in env');
    const ts = Math.floor(Date.now() / 1000).toString();
    const signed = actor
        ? `${ts}.${b64urlEncode(enc.encode(JSON.stringify({ platformAdminId: actor.platformAdminId, email: actor.email })))}`
        : ts;
    const key = await deriveHmacKey(pems[0] as string);
    const mac = await crypto.subtle.sign('HMAC', key, enc.encode(signed));
    return `${signed}.${toHex(mac)}`;
}

/**
 * Verify an inbound `x-portal-m2m` header. `ok` iff signature valid + in-window.
 *
 * ⚠️ `actor` is meaningful ONLY when `ok` is true. Callers must not read it off a
 * rejected verification — it is exactly the value an attacker would be trying to
 * set, and a guard that logged or trusted it on the failure path would hand them
 * the field the whole design protects.
 */
export async function verifyM2mHeader(
    env: Record<string, string | undefined>,
    headerValue: string | undefined | null,
): Promise<M2mVerification> {
    const no: M2mVerification = { ok: false, actor: null };
    if (!headerValue) return no;
    const parts = headerValue.split('.');
    if (parts.length !== 2 && parts.length !== 3) return no;
    const mac = parts[parts.length - 1] as string;
    const signed = parts.slice(0, -1).join('.');
    const ts = parts[0] as string;
    if (ts.length === 0 || mac.length === 0) return no;
    const tsNum = Number(ts);
    if (!Number.isFinite(tsNum)) return no;
    if (Math.abs(Math.floor(Date.now() / 1000) - tsNum) > MAX_SKEW_SECONDS) return no;
    // Decoded BEFORE the MAC check only so a malformed actor is rejected the
    // same way a forged one is; the value is returned only after the MAC holds.
    const actor = parts.length === 3 ? decodeActor(parts[1] as string) : null;
    if (parts.length === 3 && !actor) return no;
    for (const pem of privateKeyPems(env)) {
        const key = await deriveHmacKey(pem);
        const expected = toHex(await crypto.subtle.sign('HMAC', key, enc.encode(signed)));
        if (timingSafeEqual(expected, mac)) return { ok: true, actor };
    }
    return no;
}
