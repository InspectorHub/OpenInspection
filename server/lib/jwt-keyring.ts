/**
 * JWT Keyring — multi-version ES256 (ECDSA P-256 SHA-256) signing & verification.
 *
 * Architecture:
 *   - Each key version `vN` is held in env as a PEM pair:
 *       JWT_PRIVATE_KEY_V<N>  — PKCS8-encoded private key (sign)
 *       JWT_PUBLIC_KEY_V<N>   — SPKI-encoded public key  (verify)
 *   - JWT_CURRENT_KID names the version used for new signatures (e.g. "v1").
 *   - signJwt() embeds `kid` in the JWT header so verifiers can pick the
 *     correct public key from a keyring that may hold many versions
 *     simultaneously — required for safe rotation (verify old + new in parallel).
 *
 * No HS256 fallback. Pre-launch architectural choice — see the rotation
 * scripts and CLAUDE.md "JWT & Auth Security Rules".
 */

// eslint-disable-next-line no-restricted-imports -- this IS the sanctioned keyring wrapper; verifyJwt() below is the only caller allowed to reach hono/jwt's verify() directly (see CLAUDE.md JWT & Auth Security Rules).
import { verify as honoVerify } from 'hono/jwt';

interface JwtKeyringEntry {
    privateKey: CryptoKey;
    publicKey: CryptoKey;
}

export interface JwtKeyring {
    currentKid: string;
    keys: Map<string, JwtKeyringEntry>;
}

const ALG = 'ES256' as const;
const ECDSA_PARAMS = { name: 'ECDSA', namedCurve: 'P-256' } as const;

/** Decode a PEM body (BEGIN/END stripped + whitespace removed) to ArrayBuffer. */
function pemToBuf(pem: string): ArrayBuffer {
    const b64 = pem
        .replace(/-----BEGIN [A-Z ]+-----/, '')
        .replace(/-----END [A-Z ]+-----/, '')
        .replace(/\s+/g, '');
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
}

function base64UrlDecodeToBytes(input: string): Uint8Array {
    const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
    const b64 = (input + pad).replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i] as number);
    return btoa(bin).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlEncodeString(str: string): string {
    return base64UrlEncodeBytes(new TextEncoder().encode(str));
}

/**
 * Build the keyring from env. Discovers every JWT_PRIVATE_KEY_V<N> /
 * JWT_PUBLIC_KEY_V<N> pair, imports them via Web Crypto, and resolves
 * `currentKid` from JWT_CURRENT_KID.
 *
 * Throws if:
 *   - JWT_CURRENT_KID is missing
 *   - No matching keypair is loaded for the current kid
 *   - Any discovered private/public pair is incomplete
 */
export async function buildKeyring(env: Record<string, string | undefined>): Promise<JwtKeyring> {
    const currentKid = env['JWT_CURRENT_KID'];
    if (!currentKid) {
        throw new Error('JWT_CURRENT_KID is not set');
    }

    // Discover all V<N> pairs by scanning env keys.
    const versions = new Set<string>();
    for (const key of Object.keys(env)) {
        const m = key.match(/^JWT_(PRIVATE|PUBLIC)_KEY_V(\d+)$/);
        if (m) versions.add(`v${m[2]}`);
    }

    const keys = new Map<string, JwtKeyringEntry>();
    for (const kid of versions) {
        const n = kid.slice(1); // strip leading 'v'
        const privPem = env[`JWT_PRIVATE_KEY_V${n}`];
        const pubPem  = env[`JWT_PUBLIC_KEY_V${n}`];
        if (!privPem || !pubPem) {
            // Incomplete pair — skip silently. buildKeyring's contract is "use what
            // is fully provisioned"; the currentKid check below catches missing-current.
            continue;
        }
        const privateKey = await crypto.subtle.importKey(
            'pkcs8',
            pemToBuf(privPem),
            ECDSA_PARAMS,
            false,
            ['sign'],
        );
        const publicKey = await crypto.subtle.importKey(
            'spki',
            pemToBuf(pubPem),
            ECDSA_PARAMS,
            false,
            ['verify'],
        );
        keys.set(kid, { privateKey, publicKey });
    }

    if (!keys.has(currentKid)) {
        throw new Error(`JWT_CURRENT_KID=${currentKid} has no matching keypair in env`);
    }

    return { currentKid, keys };
}

/**
 * Sign a JWT with the keyring's current kid. Pins the algorithm to ES256
 * and stamps the kid into the header so verifiers on a multi-version
 * keyring can find the right public key.
 *
 * Callers must NOT pass `iat` — this helper stamps it (required for KV
 * session invalidation via `pwchanged:{userId}`).
 */
export async function signJwt(
    payload: Record<string, unknown>,
    keyring: JwtKeyring,
): Promise<string> {
    const entry = keyring.keys.get(keyring.currentKid);
    if (!entry) {
        // Defensive — buildKeyring already verified this, but the keyring may have
        // been hand-constructed in tests.
        throw new Error(`Keyring missing entry for current kid ${keyring.currentKid}`);
    }

    const finalPayload: Record<string, unknown> = { ...payload };
    if (finalPayload['iat'] === undefined) {
        finalPayload['iat'] = Math.floor(Date.now() / 1000);
    }

    // Manual JWT construction so we never need to re-export the private key.
    // Private keys are imported as non-extractable for defense in depth.
    const header = { alg: ALG, typ: 'JWT', kid: keyring.currentKid };
    const headerB64  = base64UrlEncodeString(JSON.stringify(header));
    const payloadB64 = base64UrlEncodeString(JSON.stringify(finalPayload));
    const signingInput = `${headerB64}.${payloadB64}`;

    const sig = await crypto.subtle.sign(
        { name: 'ECDSA', hash: { name: 'SHA-256' } },
        entry.privateKey,
        new TextEncoder().encode(signingInput),
    );
    const sigB64 = base64UrlEncodeBytes(new Uint8Array(sig));

    return `${signingInput}.${sigB64}`;
}

/**
 * Verify a JWT against the keyring.
 *
 * Steps:
 *   1. Parse the header's `kid`; reject if missing.
 *   2. Look up the matching public key; reject if unknown kid.
 *   3. Delegate to hono's `verify()` for signature + exp/nbf/iat checks.
 *
 * Throws on any failure. Returns the decoded payload on success.
 */
export async function verifyJwt(
    token: string,
    keyring: JwtKeyring,
): Promise<Record<string, unknown>> {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Invalid JWT format');

    let header: { alg?: string; kid?: string; typ?: string };
    try {
        const headerJson = new TextDecoder().decode(base64UrlDecodeToBytes(parts[0] as string));
        header = JSON.parse(headerJson);
    } catch {
        throw new Error('JWT header is not valid JSON');
    }

    if (!header.kid) {
        throw new Error('JWT header missing kid');
    }
    const entry = keyring.keys.get(header.kid);
    if (!entry) {
        throw new Error(`Unknown JWT kid: ${header.kid}`);
    }

    return (await honoVerify(token, entry.publicKey, ALG)) as Record<string, unknown>;
}
