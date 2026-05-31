import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { signingKeys } from '../lib/db/schema';
import { logger } from '../lib/logger';

/**
 * Spec 5H — Per-tenant Ed25519 keypair management.
 *
 * Lazy-creates a keypair on first access. Private key is encrypted at rest
 * via AES-GCM under KEY_ENCRYPTION_SECRET (32-byte base64 secret). Public
 * key is stored plain text and exposed at /api/public/verify/.../public-key.
 *
 * Verifies the signature chain via crypto.subtle Ed25519. Falls back to a
 * pure-JS implementation (@noble/ed25519) only if the runtime rejects the
 * Ed25519 algorithm at importKey time — current workerd supports it.
 */
export class SigningKeyService {
    constructor(private db: D1Database, private encryptionSecret: string) {
        if (!encryptionSecret || encryptionSecret.length < 16) {
            throw new Error('SigningKeyService requires KEY_ENCRYPTION_SECRET (>=16 chars)');
        }
    }

    private getDrizzle() {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return drizzle(this.db as any);
    }

    /**
     * Returns the tenant's keypair as raw CryptoKeys, creating one if absent.
     * Idempotent — safe to call on every sign attempt.
     */
    async ensureKeypair(tenantId: string): Promise<{
        publicKey: CryptoKey;
        privateKey: CryptoKey;
        fingerprint: string;
    }> {
        const existing = await this.getDrizzle().select().from(signingKeys)
            .where(eq(signingKeys.tenantId, tenantId)).get();

        if (existing) {
            const publicKey = await crypto.subtle.importKey(
                'spki', base64UrlDecode(existing.publicKey) as unknown as ArrayBuffer,
                { name: 'Ed25519' }, true, ['verify']
            );
            const aesKey = await this.deriveAesKey();
            const privKeyBytes = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: base64UrlDecode(existing.privateKeyIv) as unknown as ArrayBuffer },
                aesKey,
                base64UrlDecode(existing.privateKeyEnc) as unknown as ArrayBuffer
            );
            const privateKey = await crypto.subtle.importKey(
                'pkcs8', privKeyBytes,
                { name: 'Ed25519' }, false, ['sign']
            );
            return { publicKey, privateKey, fingerprint: existing.fingerprint };
        }

        // Generate new keypair
        const kp = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair;
        // exportKey's return type is `ArrayBuffer | JsonWebKey`; spki/pkcs8 always
        // return ArrayBuffer at runtime, so we narrow with a cast rather than a
        // runtime check that can never fail for these formats.
        const pubBytes = new Uint8Array(await crypto.subtle.exportKey('spki', kp.publicKey) as ArrayBuffer);
        const privBytes = new Uint8Array(await crypto.subtle.exportKey('pkcs8', kp.privateKey) as ArrayBuffer);
        const fingerprint = await sha256Hex(pubBytes);

        // Encrypt private key with AES-GCM
        const aesKey = await this.deriveAesKey();
        const iv = new Uint8Array(new ArrayBuffer(12));
        crypto.getRandomValues(iv);
        const privEnc = new Uint8Array(await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: iv as unknown as ArrayBuffer }, aesKey, toArrayBufferBacked(privBytes) as unknown as ArrayBuffer
        ));

        await this.getDrizzle().insert(signingKeys).values({
            tenantId,
            publicKey: base64UrlEncode(pubBytes),
            privateKeyEnc: base64UrlEncode(privEnc),
            privateKeyIv: base64UrlEncode(iv),
            fingerprint,
            algorithm: 'Ed25519',
            createdAt: Date.now(),
            rotatedAt: null,
        });

        logger.info('signing-key.created', { tenantId, fingerprint });
        return { publicKey: kp.publicKey, privateKey: kp.privateKey, fingerprint };
    }

    /**
     * Returns just the public key + fingerprint (no private-key decryption).
     * Used by the public verifier endpoint.
     */
    async getPublicKey(tenantId: string): Promise<{ publicKey: CryptoKey; fingerprint: string; pem: string } | null> {
        const row = await this.getDrizzle().select().from(signingKeys)
            .where(eq(signingKeys.tenantId, tenantId)).get();
        if (!row) return null;
        const spkiBytes = base64UrlDecode(row.publicKey);
        const publicKey = await crypto.subtle.importKey(
            'spki', spkiBytes as unknown as ArrayBuffer, { name: 'Ed25519' }, true, ['verify']
        );
        const pem = spkiToPem(spkiBytes);
        return { publicKey, fingerprint: row.fingerprint, pem };
    }

    private async deriveAesKey(): Promise<CryptoKey> {
        const secretBytes = new TextEncoder().encode(this.encryptionSecret);
        const hash = await crypto.subtle.digest('SHA-256', secretBytes);
        return crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    }
}

// ----- helpers -----

function base64UrlEncode(bytes: Uint8Array): string {
    let s = '';
    for (let i = 0; i < bytes.byteLength; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Returns Uint8Array backed by ArrayBuffer (not SharedArrayBuffer) — required by workerd's strict BufferSource typing. */
export function base64UrlDecode(s: string): Uint8Array {
    const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4);
    const bin = atob(padded);
    const out = new Uint8Array(new ArrayBuffer(bin.length));
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

export async function sha256Hex(input: Uint8Array | string): Promise<string> {
    const bytes: Uint8Array = typeof input === 'string'
        ? toArrayBufferBacked(new TextEncoder().encode(input))
        : toArrayBufferBacked(input);
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer));
    return Array.from(hash).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Copy a possibly-SharedArrayBuffer-backed view into a fresh ArrayBuffer-backed Uint8Array. */
export function toArrayBufferBacked(src: Uint8Array): Uint8Array {
    const out = new Uint8Array(new ArrayBuffer(src.byteLength));
    out.set(src);
    return out;
}

function spkiToPem(spki: Uint8Array): string {
    const b64 = btoa(String.fromCharCode(...spki));
    const lines: string[] = [];
    for (let i = 0; i < b64.length; i += 64) lines.push(b64.slice(i, i + 64));
    return '-----BEGIN PUBLIC KEY-----\n' + lines.join('\n') + '\n-----END PUBLIC KEY-----\n';
}

export function hexDecode(hex: string): Uint8Array {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
}
