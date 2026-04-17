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
export async function decryptSecrets(encrypted: string, jwtSecret: string): Promise<Record<string, string>> {
    const colonIdx = encrypted.indexOf(':');
    if (colonIdx === -1) throw new Error('Invalid encrypted secrets format');
    const iv = fromB64(encrypted.slice(0, colonIdx));
    const ciphertext = fromB64(encrypted.slice(colonIdx + 1));
    const key = await deriveKey(jwtSecret);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return JSON.parse(new TextDecoder().decode(plaintext));
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
