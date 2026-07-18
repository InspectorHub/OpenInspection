/**
 * AES-256-GCM encryption for tenant secrets stored in D1.
 * Key is derived from JWT_SECRET via PBKDF2 — secrets are unreadable without the Worker secret.
 */

const SALT = new TextEncoder().encode('openinspection-config-v1');
const MASK_CHAR = '•';

async function deriveKey(jwtSecret: string): Promise<CryptoKey> {
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(jwtSecret),
        'PBKDF2',
        false,
        ['deriveKey']
    );
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: SALT, iterations: 100_000, hash: 'SHA-256' },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

function toB64(buf: ArrayBuffer | Uint8Array): string {
    return btoa(String.fromCharCode(...new Uint8Array(buf instanceof Uint8Array ? buf.buffer : buf)));
}

function fromB64(s: string): Uint8Array<ArrayBuffer> {
    const decoded = atob(s);
    const buf = new ArrayBuffer(decoded.length);
    const arr = new Uint8Array(buf);
    for (let i = 0; i < decoded.length; i++) arr[i] = decoded.charCodeAt(i);
    return arr;
}

/** Encrypt a flat object of secrets. Returns `ivB64:ciphertextB64`. */
export async function encryptSecrets(data: Record<string, string>, jwtSecret: string): Promise<string> {
    const key = await deriveKey(jwtSecret);
    // Use explicit ArrayBuffer so TypeScript types iv as Uint8Array<ArrayBuffer> (required by SubtleCrypto)
    const iv = new Uint8Array(new ArrayBuffer(12));
    crypto.getRandomValues(iv);
    const plaintext = new TextEncoder().encode(JSON.stringify(data));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
    return `${toB64(iv)}:${toB64(ciphertext)}`;
}

/** Decrypt a string produced by encryptSecrets. Returns the original object. */
async function decryptSecrets(encrypted: string, jwtSecret: string): Promise<Record<string, string>> {
    const colonIdx = encrypted.indexOf(':');
    if (colonIdx === -1) throw new Error('Invalid encrypted secrets format');
    const iv = fromB64(encrypted.slice(0, colonIdx));
    const ciphertext = fromB64(encrypted.slice(colonIdx + 1));
    const key = await deriveKey(jwtSecret);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return JSON.parse(new TextDecoder().decode(plaintext));
}

// ─── Envelope encryption (v2, 2026-06-07) ───────────────────────────────────
// Random per-tenant DEK encrypts the secrets JSON; the DEK is stored wrapped
// (AES-GCM) under a KEK derived from JWT_SECRET via HKDF. Rotating JWT_SECRET
// only re-wraps DEKs — data blobs are untouched. AAD = tenantId on BOTH layers
// binds ciphertext to its tenant (transplant defense). Formats:
//   dek_enc:            k1:<ivB64>:<wrappedB64>
//   secrets_enc:  v2:<ivB64>:<cipherB64>
//   legacy (pre-v2):    <ivB64>:<cipherB64>   — PBKDF2 global key, read-only,
//                        kept permanently for OSS self-host upgrades.

const KEK_SALT = new TextEncoder().encode('openinspection-kek');
const KEK_INFO = new TextEncoder().encode('kek-v1');

async function deriveKek(jwtSecret: string): Promise<CryptoKey> {
    const material = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(jwtSecret), 'HKDF', false, ['deriveKey'],
    );
    return crypto.subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: KEK_SALT, info: KEK_INFO },
        material,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
    );
}

function aad(tenantId: string): Uint8Array<ArrayBuffer> {
    const bytes = new TextEncoder().encode(tenantId);
    const buf = new ArrayBuffer(bytes.length);
    new Uint8Array(buf).set(bytes);
    return new Uint8Array(buf);
}

function randomBytes(n: number): Uint8Array<ArrayBuffer> {
    const arr = new Uint8Array(new ArrayBuffer(n));
    crypto.getRandomValues(arr);
    return arr;
}

/** Wraps a raw DEK under the KEK derived from jwtSecret. AAD = tenantId. */
export async function wrapDek(dek: Uint8Array, tenantId: string, jwtSecret: string): Promise<string> {
    const kek = await deriveKek(jwtSecret);
    const iv = randomBytes(12);
    // Copy onto an explicit ArrayBuffer — SubtleCrypto's BufferSource typing
    // rejects ArrayBufferLike-backed views under the app tsconfig.
    const dekBuf = new ArrayBuffer(dek.length);
    new Uint8Array(dekBuf).set(dek);
    const wrapped = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: aad(tenantId) }, kek, dekBuf,
    );
    return `k1:${toB64(iv)}:${toB64(wrapped)}`;
}

/** Unwraps a `k1:` dek_enc. Throws on format/AAD/key mismatch. */
export async function unwrapDek(dekEnc: string, tenantId: string, jwtSecret: string): Promise<Uint8Array> {
    const parts = dekEnc.split(':');
    if (parts.length !== 3 || parts[0] !== 'k1') throw new Error('Invalid dek_enc format');
    const kek = await deriveKek(jwtSecret);
    const dek = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: fromB64(parts[1]), additionalData: aad(tenantId) },
        kek, fromB64(parts[2]),
    );
    return new Uint8Array(dek);
}

async function importDek(dek: Uint8Array): Promise<CryptoKey> {
    const buf = new ArrayBuffer(dek.length);
    new Uint8Array(buf).set(dek);
    return crypto.subtle.importKey('raw', buf, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export interface SealedSecrets { blob: string; dekEnc: string }

/**
 * Encrypts a secrets object under the tenant's DEK (envelope, v2). Reuses the
 * existing DEK when `existingDekEnc` unwraps (current → previous fallback);
 * otherwise generates a fresh one. The returned dekEnc is ALWAYS wrapped under
 * the CURRENT jwtSecret — rotation converges on write.
 */
export async function sealSecrets(
    data: Record<string, string>,
    tenantId: string,
    jwtSecret: string,
    existingDekEnc?: string | null,
    previousJwtSecret?: string,
): Promise<SealedSecrets> {
    let dek: Uint8Array | null = null;
    if (existingDekEnc) {
        try { dek = await unwrapDek(existingDekEnc, tenantId, jwtSecret); } catch { /* try previous */ }
        if (!dek && previousJwtSecret) {
            try { dek = await unwrapDek(existingDekEnc, tenantId, previousJwtSecret); } catch { /* regenerate */ }
        }
    }
    if (!dek) dek = randomBytes(32);
    const key = await importDek(dek);
    const iv = randomBytes(12);
    const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: aad(tenantId) },
        key, new TextEncoder().encode(JSON.stringify(data)),
    );
    const dekEnc = await wrapDek(dek, tenantId, jwtSecret);
    return { blob: `v2:${toB64(iv)}:${toB64(ciphertext)}`, dekEnc };
}

/**
 * Decrypts a secrets blob of ANY supported format:
 *  - `v2:` envelope — unwrap DEK (current → previous KEK), AES-GCM w/ AAD
 *  - legacy un-prefixed — PBKDF2 global key (current → previous)
 */
export async function openSecrets(
    blob: string,
    dekEnc: string | null | undefined,
    tenantId: string,
    jwtSecret: string,
    previousJwtSecret?: string,
): Promise<Record<string, string>> {
    if (blob.startsWith('v2:')) {
        if (!dekEnc) throw new Error('v2 secrets blob without dek_enc');
        let dek: Uint8Array;
        try {
            dek = await unwrapDek(dekEnc, tenantId, jwtSecret);
        } catch (err) {
            if (!previousJwtSecret) throw err;
            dek = await unwrapDek(dekEnc, tenantId, previousJwtSecret);
        }
        const parts = blob.split(':');
        if (parts.length !== 3) throw new Error('Invalid v2 secrets blob format');
        const key = await importDek(dek);
        const plaintext = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: fromB64(parts[1]), additionalData: aad(tenantId) },
            key, fromB64(parts[2]),
        );
        return JSON.parse(new TextDecoder().decode(plaintext));
    }
    try {
        return await decryptSecrets(blob, jwtSecret);
    } catch (err) {
        if (!previousJwtSecret) throw err;
        return decryptSecrets(blob, previousJwtSecret);
    }
}

// ─── Track I-a — tier-2 token sealing ───────────────────────────────────────
// Independent HKDF purpose key (NOT the tenant DEK — tokens must seal even for
// tenants that never saved secrets). Shares the KEK salt with a distinct info
// string. Format 't1:<ivB64>:<cipherB64>', AAD = `token:${tenantId}` binds the
// ciphertext to its tenant. Rotation contract matches the KEK: the current
// secret seals, the previous secret is a read-fallback (JWT_SECRET_PREVIOUS
// window).

const TOKEN_KEK_INFO = new TextEncoder().encode('token-enc-v1');

async function deriveTokenKey(jwtSecret: string): Promise<CryptoKey> {
    const material = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(jwtSecret), 'HKDF', false, ['deriveKey'],
    );
    return crypto.subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: KEK_SALT, info: TOKEN_KEK_INFO },
        material,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
    );
}

/** AAD scoped to the token namespace so a token blob never decrypts as a secrets blob. */
function tokenAad(tenantId: string): Uint8Array<ArrayBuffer> {
    return aad(`token:${tenantId}`);
}

/** Seals a tier-2 token under a tenant-bound key. Returns `t1:<ivB64>:<cipherB64>`. */
export async function sealToken(token: string, tenantId: string, jwtSecret: string): Promise<string> {
    const key = await deriveTokenKey(jwtSecret);
    const iv = randomBytes(12);
    const cipher = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: tokenAad(tenantId) },
        key, new TextEncoder().encode(token),
    );
    return `t1:${toB64(iv)}:${toB64(cipher)}`;
}

/** Opens a `t1:` token_enc (current → previous KEK). Throws on format/AAD/key mismatch. */
export async function openToken(
    tokenEnc: string,
    tenantId: string,
    jwtSecret: string,
    jwtSecretPrevious?: string,
): Promise<string> {
    const parts = tokenEnc.split(':');
    if (parts.length !== 3 || parts[0] !== 't1') throw new Error('Invalid token_enc format');
    const ivB64 = parts[1];
    const cipherB64 = parts[2];
    const attempt = async (secret: string): Promise<string> => {
        const key = await deriveTokenKey(secret);
        const plain = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: fromB64(ivB64), additionalData: tokenAad(tenantId) },
            key, fromB64(cipherB64),
        );
        return new TextDecoder().decode(plain);
    };
    try {
        return await attempt(jwtSecret);
    } catch (err) {
        if (!jwtSecretPrevious) throw err;
        return attempt(jwtSecretPrevious);
    }
}

/**
 * Mask a secret for safe display in API responses.
 * "re_1ABCxyz" → "re_1••••••••xyz" (first 4 + 8 dots + last 4 if long enough)
 */
export function maskSecret(value: string | null | undefined): string {
    if (!value) return '';
    if (value.length <= 8) return MASK_CHAR.repeat(8);
    return value.slice(0, 4) + MASK_CHAR.repeat(8) + value.slice(-4);
}

/** Returns true if a value submitted from the frontend is a mask placeholder (unchanged). */
export function isMasked(value: string | undefined | null): boolean {
    if (!value) return false;
    return value.includes(MASK_CHAR);
}
