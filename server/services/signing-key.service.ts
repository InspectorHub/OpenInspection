import { drizzle } from 'drizzle-orm/d1';
import { and, eq, isNull } from 'drizzle-orm';
import { signingKeys } from '../lib/db/schema';
import { logger } from '../lib/logger';
import { errorSummary } from '../lib/error-summary';
import { sha256Hex } from '../lib/sha256';
import { signingKeySecrets, type SigningKeyEnv } from '../lib/signing-key-secrets';

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
    /**
     * @param encryptionSecret   the secret new private-key wrappings are made under.
     * @param previousSecrets    secrets a stored wrapping may still be under (see `signingKeySecrets`). A wrapping made under one of
     *                           them is opened with it and re-wrapped under `encryptionSecret` the first time it is used.
     */
    constructor(private db: D1Database, private encryptionSecret: string, private previousSecrets: readonly string[] = []) {
        if (!encryptionSecret || encryptionSecret.length < 16) {
            throw new Error('SigningKeyService requires KEY_ENCRYPTION_SECRET (>=16 chars)');
        }
    }

    /**
     * The service for a deployment: the current wrapping secret, and every earlier one a stored key might still be under. This is the
     * way to build one from an environment; a caller that holds the secrets already (a service that was handed them) uses `fromSecrets`.
     * Nothing outside this file calls the constructor (tests/unit/esign/signing-key-construction.spec.ts), so a caller cannot leave
     * out the earlier secrets and fail after a rotation.
     */
    static fromEnv(db: D1Database, env: SigningKeyEnv): SigningKeyService {
        const { current, previous } = signingKeySecrets(env);
        return SigningKeyService.fromSecrets(db, current, previous);
    }

    static fromSecrets(db: D1Database, current: string, previous: readonly string[]): SigningKeyService {
        return new SigningKeyService(db, current, previous);
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
            const privKeyBytes = await this.unwrapPrivateKey(existing);
            const privateKey = await crypto.subtle.importKey(
                'pkcs8', privKeyBytes,
                { name: 'Ed25519' }, false, ['sign']
            );
            return { publicKey, privateKey, fingerprint: existing.fingerprint };
        }

        try {
            return await this.mintActiveKey(tenantId);
        } catch (e) {
            // Two requests that both found no active key both mint; the partial unique index lets one win. The loser uses the winner's key
            // instead of failing the request (and, now that a signature needs its audit row, instead of refusing the signer).
            if (!isUniqueViolation(e)) throw e;
            const winner = await this.getDrizzle().select().from(signingKeys)
                .where(and(eq(signingKeys.tenantId, tenantId), isNull(signingKeys.retiredAt))).get();
            if (!winner) throw e;
            return this.ensureKeypair(tenantId);
        }
    }

    /**
     * The private key's bytes, opened with the current secret or, failing that, an earlier one.
     *
     * A wrapping made under an earlier secret is opened and re-wrapped under the current one, so the earlier secret can be dropped once
     * every active key has been used. Only the wrapping changes: the public key, the fingerprint and every signature already made stay as
     * they are. When no secret opens the key the error says so, because the usual cause is that the secret it was wrapped under was changed
     * (JWT_SECRET rotated while KEY_ENCRYPTION_SECRET was unset, or KEY_ENCRYPTION_SECRET set later) and the remedy is to supply the old
     * value as JWT_SECRET_PREVIOUS, not to mint a new key (which would orphan nothing but would leave signing refused until then).
     */
    private async unwrapPrivateKey(row: typeof signingKeys.$inferSelect): Promise<ArrayBuffer> {
        const iv = base64UrlDecode(row.privateKeyIv) as unknown as ArrayBuffer;
        const wrapped = base64UrlDecode(row.privateKeyEnc) as unknown as ArrayBuffer;
        const candidates = [this.encryptionSecret, ...this.previousSecrets];
        for (const [index, secret] of candidates.entries()) {
            let bytes: ArrayBuffer;
            try {
                bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await this.deriveAesKey(secret), wrapped);
            } catch {
                continue;
            }
            if (index > 0) await this.rewrap(row, bytes);
            return bytes;
        }
        logger.alert('signing_key_unwrap', 'A tenant signing key cannot be opened with any configured secret; signing is refused until the secret it was wrapped under is supplied (as JWT_SECRET_PREVIOUS).', { tenantId: row.tenantId, fingerprint: row.fingerprint });
        throw new Error('The signing key cannot be opened with the configured secrets. Supply the secret it was wrapped under as JWT_SECRET_PREVIOUS.');
    }

    /**
     * Re-wrap an active key's private half under the current secret. A failure leaves the old wrapping, which still opens.
     *
     * Before anything is written, the NEW ciphertext is opened again with the new key and must give back exactly the bytes that went in;
     * otherwise nothing is written and an alert is raised. The write is a compare-and-set on the old ciphertext, and 'rewrapped' is
     * reported only when it changed one row (a concurrent re-wrap leaves this call a no-op: 'raced').
     */
    private async rewrap(row: typeof signingKeys.$inferSelect, privBytes: ArrayBuffer): Promise<'rewrapped' | 'raced' | 'failed'> {
        try {
            const key = await this.deriveAesKey(this.encryptionSecret);
            const iv = new Uint8Array(new ArrayBuffer(12));
            crypto.getRandomValues(iv);
            const enc = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as unknown as ArrayBuffer }, key, privBytes));
            const back = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as unknown as ArrayBuffer }, key, enc));
            const original = new Uint8Array(privBytes);
            if (back.length !== original.length || back.some((byte, i) => byte !== original[i])) {
                logger.alert('signing_key_rewrap_mismatch', 'A re-wrapped signing key did not open back to the same bytes; the stored wrapping was left as it was.', { tenantId: row.tenantId, fingerprint: row.fingerprint });
                return 'failed';
            }
            const res: unknown = await this.getDrizzle().update(signingKeys)
                .set({ privateKeyEnc: base64UrlEncode(enc), privateKeyIv: base64UrlEncode(iv) })
                // Compare-and-set on the old ciphertext: a concurrent re-wrap by another request leaves this one a no-op.
                .where(and(eq(signingKeys.id, row.id), eq(signingKeys.tenantId, row.tenantId), eq(signingKeys.privateKeyEnc, row.privateKeyEnc))).run();
            const changes = (res as { meta?: { changes?: number }; changes?: number } | undefined);
            if ((changes?.meta?.changes ?? changes?.changes ?? 0) !== 1) return 'raced';
            logger.info('signing-key.rewrapped', { tenantId: row.tenantId, fingerprint: row.fingerprint });
            return 'rewrapped';
        } catch (e) {
            logger.warn('signing-key.rewrap.failed', { tenantId: row.tenantId, fingerprint: row.fingerprint, error: errorSummary(e) });
            return 'failed';
        }
    }

    /**
     * Re-wrap EVERY active key that is still under an earlier secret, in chunks of `chunk` rows, so the earlier secret can be removed
     * without stranding a tenant that has not signed since the secret changed. Retired keys are not touched: they never sign again.
     *
     * `remaining` is the number the operator needs before deleting JWT_SECRET_PREVIOUS: active keys that are STILL not under the current
     * secret afterwards (re-wrap failed, or no configured secret opens them). Zero means the previous secret is no longer needed.
     * Idempotent; only the wrapping of a private key changes, never a public key, fingerprint or signature.
     */
    async rewrapAll(chunk = 25): Promise<{ rewrapped: number; alreadyCurrent: number; remaining: number }> {
        const db = this.getDrizzle();
        const report = { rewrapped: 0, alreadyCurrent: 0, remaining: 0 };
        for (let offset = 0; ; offset += chunk) {
            const rows = await db.select().from(signingKeys).where(isNull(signingKeys.retiredAt)).orderBy(signingKeys.id).limit(chunk).offset(offset).all();
            for (const row of rows) {
                const iv = base64UrlDecode(row.privateKeyIv) as unknown as ArrayBuffer;
                const wrapped = base64UrlDecode(row.privateKeyEnc) as unknown as ArrayBuffer;
                let outcome: 'current' | 'rewrapped' | 'unresolved' = 'unresolved';
                for (const [index, secret] of [this.encryptionSecret, ...this.previousSecrets].entries()) {
                    let bytes: ArrayBuffer;
                    try { bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await this.deriveAesKey(secret), wrapped); } catch { continue; }
                    // 'raced' means another writer converted it first: it is under the current secret now.
                    outcome = index === 0 ? 'current' : (await this.rewrap(row, bytes)) === 'failed' ? 'unresolved' : 'rewrapped';
                    break;
                }
                if (outcome === 'current') report.alreadyCurrent += 1;
                else if (outcome === 'rewrapped') report.rewrapped += 1;
                else {
                    report.remaining += 1;
                    logger.warn('signing-key.rewrap.remaining', { tenantId: row.tenantId, fingerprint: row.fingerprint });
                }
            }
            if (rows.length < chunk) return report;
        }
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
        const db = this.getDrizzle();
        const active = await db.select().from(signingKeys)
            .where(and(eq(signingKeys.tenantId, tenantId), isNull(signingKeys.retiredAt))).get();

        // Everything that can fail for a reason other than the database (key generation, wrapping) happens BEFORE the first write, so a
        // failure there leaves the current key active. The retirement and the new key are then written together: a batch is one
        // transaction on D1, so there is no moment with no active key. (A driver without batch writes them in turn, retire first because
        // the partial unique index allows one active key per tenant; the next signing request mints a key if the second write failed.)
        const fresh = await this.generateWrappedKey(tenantId);
        const retire = active
            ? db.update(signingKeys).set({ retiredAt: new Date() })
                // `active.id` already came from a tenant-scoped read, so the tenant filter is redundant, and kept: it costs one comparison, and
                // what it would prevent is retiring another company's signing key.
                .where(and(eq(signingKeys.id, active.id), eq(signingKeys.tenantId, tenantId)))
            : null;
        const insert = db.insert(signingKeys).values(fresh.row);
        const batch = (db as unknown as { batch?: (queries: unknown[]) => Promise<unknown> }).batch;
        if (retire && typeof batch === 'function') {
            await batch.call(db, [retire, insert]);
        } else {
            if (retire) await retire.run();
            await insert.run();
        }
        logger.info('signing-key.created', { tenantId, fingerprint: fresh.fingerprint });
        logger.info('signing-key.rotated', {
            tenantId, retired: active?.fingerprint ?? null, active: fresh.fingerprint,
        });
        return { fingerprint: fresh.fingerprint, retired: active?.fingerprint ?? null };
    }

    /** Generate a keypair and wrap its private half under the current secret; nothing is written. */
    private async generateWrappedKey(tenantId: string): Promise<{
        row: typeof signingKeys.$inferInsert;
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
        const aesKey = await this.deriveAesKey(this.encryptionSecret);
        const iv = new Uint8Array(new ArrayBuffer(12));
        crypto.getRandomValues(iv);
        const privEnc = new Uint8Array(await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: iv as unknown as ArrayBuffer }, aesKey, toArrayBufferBacked(privBytes) as unknown as ArrayBuffer
        ));
        return {
            row: {
                id: crypto.randomUUID(),
                tenantId,
                publicKey: base64UrlEncode(pubBytes),
                privateKeyEnc: base64UrlEncode(privEnc),
                privateKeyIv: base64UrlEncode(iv),
                fingerprint,
                algorithm: 'Ed25519',
                createdAt: new Date(),
                retiredAt: null,
            },
            publicKey: kp.publicKey,
            privateKey: kp.privateKey,
            fingerprint,
        };
    }

    /** Generate, encrypt and store a fresh ACTIVE keypair for the tenant. */
    private async mintActiveKey(tenantId: string): Promise<{
        publicKey: CryptoKey;
        privateKey: CryptoKey;
        fingerprint: string;
    }> {
        const fresh = await this.generateWrappedKey(tenantId);
        await this.getDrizzle().insert(signingKeys).values(fresh.row);
        logger.info('signing-key.created', { tenantId, fingerprint: fresh.fingerprint });
        return { publicKey: fresh.publicKey, privateKey: fresh.privateKey, fingerprint: fresh.fingerprint };
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

    private async deriveAesKey(secret: string): Promise<CryptoKey> {
        const secretBytes = new TextEncoder().encode(secret);
        const hash = await crypto.subtle.digest('SHA-256', secretBytes);
        return crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    }
}

// ----- secrets: see ../lib/signing-key-secrets.ts -----
export { signingKeySecrets, type SigningKeyEnv };

function isUniqueViolation(err: unknown): boolean {
    for (let e: unknown = err, depth = 0; e && depth < 4; depth += 1) {
        if (/UNIQUE constraint failed/i.test(e instanceof Error ? e.message : String(e))) return true;
        e = (e as { cause?: unknown }).cause;
    }
    return false;
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
