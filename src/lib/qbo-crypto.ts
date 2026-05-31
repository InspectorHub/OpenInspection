/**
 * AES-256-GCM encryption for QuickBooks Online OAuth tokens stored in D1.
 * Key is derived from JWT_SECRET via HKDF — tokens are unreadable without the Worker secret.
 */

const HKDF_INFO = new TextEncoder().encode('qbo-token-encryption');
const HKDF_SALT = new TextEncoder().encode('openinspection-qbo-v1');

export async function deriveKey(jwtSecret: string): Promise<CryptoKey> {
    const raw = new TextEncoder().encode(jwtSecret);
    const baseKey = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info: HKDF_INFO },
        baseKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
    );
}

export async function encryptToken(plaintext: string, jwtSecret: string): Promise<string> {
    const key = await deriveKey(jwtSecret);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plaintext);
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
    const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), iv.byteLength);
    return btoa(Array.from(combined, b => String.fromCharCode(b)).join(''));
}

export async function decryptToken(encrypted: string, jwtSecret: string): Promise<string> {
    const key = await deriveKey(jwtSecret);
    const combined = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return new TextDecoder().decode(plaintext);
}
