import { drizzle } from 'drizzle-orm/d1';
import { and, eq, isNull } from 'drizzle-orm';
import { signingKeys } from '../lib/db/schema';
import { logger } from '../lib/logger';
import { sha256Hex } from '../lib/sha256';

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
 *
 * **Rotation keeps history.** `rotateKeypair` retires the active key and mints a
 * new one; the retired row stays forever. Old evidence keeps verifying because
 * the verifiers resolve a key by the fingerprint recorded on each row they are
 * checking (`getPublicKeyByFingerprint`), never by asking what the tenant's key
 * is today. That is the same shape as the ES256 JWT keyring, which resolves a
 * token by its `kid` — with one asymmetry that matters: a JWT kid may be pruned
 * once its sessions expire, and an e-sign key may never be, because what it
 * sealed is evidence rather than a session.
 *
 * `getPublicKey` means the ACTIVE key and is for signing and publication
 * (/.well-known, admin). Verification must not use it: that is how a key change
 * comes to read as a forged signature.
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
     * Returns the tenant's ACTIVE keypair as raw CryptoKeys, creating one if the
     * tenant has none. Idempotent — safe to call on every sign attempt.
     *
     * Retired keys are skipped: they can still verify (see
     * `getPublicKeyByFingerprint`) but must never sign again.
     */
    async ensureKeypair(tenantId: string): Promise<{
        publicKey: CryptoKey;
        privateKey: CryptoKey;
        fingerprint: string;
    }> {
        const existing = await this.getDrizzle().select().from(signingKeys)
            .where(and(eq(signingKeys.tenantId, tenantId), isNull(signingKeys.retiredAt))).get();

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

        return this.mintActiveKey(tenantId);
    }

    /**
     * Retire the tenant's active key and mint a replacement.
     *
     * **Nothing is deleted and nothing is re-signed.** The retired row keeps its
     * public key so every chain sealed under it still verifies, and no existing
     * audit row is touched — re-sealing old evidence with a new key would be
     * manufacturing the very thing the chain exists to prove.
     *
     * Returns the new key. Safe on a tenant that has never signed: it simply
     * mints the first one.
     */
    async rotateKeypair(tenantId: string): Promise<{ fingerprint: string; retired: string | null }> {
        const active = await this.getDrizzle().select().from(signingKeys)
            .where(and(eq(signingKeys.tenantId, tenantId), isNull(signingKeys.retiredAt))).get();

        if (active) {
            // Retire BEFORE minting: the partial unique index allows one active
            // key per tenant, so doing it the other way round fails the insert.
            // `active.id` already came from a tenant-scoped read, so the
            // tenant filter here is redundant — and kept anyway. It costs one
            // comparison, and the thing it would prevent is retiring another
            // company's signing key.
            await this.getDrizzle().update(signingKeys)
                .set({ retiredAt: new Date() })
                .where(and(eq(signingKeys.id, active.id), eq(signingKeys.tenantId, tenantId))).run();
        }

        const minted = await this.mintActiveKey(tenantId);
        logger.info('signing-key.rotated', {
            tenantId, retired: active?.fingerprint ?? null, active: minted.fingerprint,
        });
        return { fingerprint: minted.fingerprint, retired: active?.fingerprint ?? null };
    }

    /** Generate, encrypt and store a fresh ACTIVE keypair for the tenant. */
    private async mintActiveKey(tenantId: string): Promise<{
        publicKey: CryptoKey;
        privateKey: CryptoKey;
        fingerprint: string;
    }> {
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
            id: crypto.randomUUID(),
            tenantId,
            publicKey: base64UrlEncode(pubBytes),
            privateKeyEnc: base64UrlEncode(privEnc),
            privateKeyIv: base64UrlEncode(iv),
            fingerprint,
            algorithm: 'Ed25519',
            createdAt: new Date(),
            retiredAt: null,
        });

        logger.info('signing-key.created', { tenantId, fingerprint });
        return { publicKey: kp.publicKey, privateKey: kp.privateKey, fingerprint };
    }

    /**
     * The tenant's ACTIVE public key — what new signatures are made with, and
     * what /.well-known publishes.
     *
     * **Not for verification.** Checking an old row against this is how a key
     * rotation comes to look like a forged signature; use
     * `getPublicKeyByFingerprint` with the fingerprint that row recorded.
     */
    async getPublicKey(tenantId: string): Promise<{ publicKey: CryptoKey; fingerprint: string; pem: string } | null> {
        const row = await this.getDrizzle().select().from(signingKeys)
            .where(and(eq(signingKeys.tenantId, tenantId), isNull(signingKeys.retiredAt))).get();
        if (!row) return null;
        const spkiBytes = base64UrlDecode(row.publicKey);
        const publicKey = await crypto.subtle.importKey(
            'spki', spkiBytes as unknown as ArrayBuffer, { name: 'Ed25519' }, true, ['verify']
        );
        const pem = spkiToPem(spkiBytes);
        return { publicKey, fingerprint: row.fingerprint, pem };
    }

    /**
     * The key with this fingerprint, active or retired. **This is the one
     * verification uses**, resolved from the fingerprint the row being checked
     * recorded when it was sealed.
     *
     * Returns null when the tenant holds no such key. That is a real answer, not
     * an error: it means the evidence names a key we cannot produce, which a
     * verifier must report as "cannot check" and never as "signature invalid".
     */
    async getPublicKeyByFingerprint(
        tenantId: string, fingerprint: string,
    ): Promise<{ publicKey: CryptoKey; fingerprint: string; pem: string; retiredAt: Date | null } | null> {
        const row = await this.getDrizzle().select().from(signingKeys)
            .where(and(eq(signingKeys.tenantId, tenantId), eq(signingKeys.fingerprint, fingerprint))).get();
        if (!row) return null;
        const spkiBytes = base64UrlDecode(row.publicKey);
        const publicKey = await crypto.subtle.importKey(
            'spki', spkiBytes as unknown as ArrayBuffer, { name: 'Ed25519' }, true, ['verify']
        );
        return {
            publicKey, fingerprint: row.fingerprint, pem: spkiToPem(spkiBytes),
            retiredAt: row.retiredAt ?? null,
        };
    }

    private async deriveAesKey(): Promise<CryptoKey> {
        const secretBytes = new TextEncoder().encode(this.encryptionSecret);
        const hash = await crypto.subtle.digest('SHA-256', secretBytes);
        return crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    }
}

// ----- helpers -----

export function base64UrlEncode(bytes: Uint8Array): string {
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

/** Copy a possibly-SharedArrayBuffer-backed view into a fresh ArrayBuffer-backed Uint8Array. */
function toArrayBufferBacked(src: Uint8Array): Uint8Array {
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
