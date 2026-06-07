/**
 * A-16 / envelope-encryption — the single loader + decrypt entry point for a
 * tenant's canonical integration secrets (`tenant_configs.encrypted_secrets`,
 * ENV-name keys, written by PUT/POST /api/admin/secrets; envelope DEK in
 * `tenant_configs.dek_enc`).
 *
 * The ciphertext pair `{blob, dekEnc}` is KV-cached AS A JSON ENVELOPE —
 * plaintext secrets NEVER land in KV. `loadTenantSecrets` is THE decrypt
 * entry point (envelope v2 + legacy blobs both supported, with a
 * `JWT_SECRET_PREVIOUS` rotation-window fallback); consumers decrypt per use —
 * AES-GCM on a small blob is sub-millisecond, the D1 round-trip was the cost.
 * `NONE` marks "tenant has no secrets" so those tenants don't re-query D1
 * every request either. Writers delete the key (see secrets.ts); the TTL
 * (300s) bounds staleness for KV's cross-colo eventual consistency. A stale
 * pre-envelope cache entry (raw blob string, not JSON) is treated as a miss
 * and overwritten.
 *
 * Used by `integrationSecretsMiddleware` (merge into c.env), the email/AI
 * config loader (own-mode Resend key + Gemini BYOK key), IntegrationsService,
 * and the admin communication endpoint.
 */
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { tenantConfigs } from './db/schema';
import { openSecrets } from './config-crypto';

const SECRETS_CACHE_PREFIX = 'intsecrets:';
const SECRETS_CACHE_TTL_S = 300;
const SECRETS_CACHE_NONE = 'NONE';

export function secretsCacheKey(tenantId: string): string {
    return `${SECRETS_CACHE_PREFIX}${tenantId}`;
}

export interface TenantSecretsCipher { blob: string; dekEnc: string | null }

/**
 * Returns the tenant's ciphertext pair {blob, dekEnc}, or null when the
 * tenant has no stored secrets. KV-cached AS CIPHERTEXT (JSON envelope);
 * plaintext never lands in KV. A stale pre-envelope cache entry (raw blob
 * string, not JSON) is treated as a miss and overwritten.
 */
export async function loadTenantSecretsCipher(
    db: D1Database,
    kv: KVNamespace | undefined,
    tenantId: string,
): Promise<TenantSecretsCipher | null> {
    const cacheKey = secretsCacheKey(tenantId);
    const cached = await kv?.get(cacheKey);
    if (cached === SECRETS_CACHE_NONE) return null;
    if (cached) {
        try {
            const parsed = JSON.parse(cached) as TenantSecretsCipher;
            if (parsed && typeof parsed.blob === 'string') return parsed;
        } catch { /* pre-envelope cache format — fall through to D1 */ }
    }

    const row = await drizzle(db)
        .select({ encryptedSecrets: tenantConfigs.encryptedSecrets, dekEnc: tenantConfigs.dekEnc })
        .from(tenantConfigs)
        .where(eq(tenantConfigs.tenantId, tenantId))
        .get();
    const out = row?.encryptedSecrets
        ? { blob: row.encryptedSecrets, dekEnc: row.dekEnc ?? null }
        : null;
    await kv?.put(cacheKey, out ? JSON.stringify(out) : SECRETS_CACHE_NONE, { expirationTtl: SECRETS_CACHE_TTL_S });
    return out;
}

/**
 * THE decrypt entry point for tenant integration secrets. Envelope (v2) and
 * legacy blobs both supported; `JWT_SECRET_PREVIOUS` (when set) is the
 * rotation-window fallback. Returns null when the tenant has no secrets.
 * Throws on undecryptable data — callers decide whether that is fatal.
 */
export async function loadTenantSecrets(
    db: D1Database,
    kv: KVNamespace | undefined,
    tenantId: string,
    jwtSecret: string,
    previousJwtSecret?: string,
): Promise<Record<string, string> | null> {
    const cipher = await loadTenantSecretsCipher(db, kv, tenantId);
    if (!cipher) return null;
    return openSecrets(cipher.blob, cipher.dekEnc, tenantId, jwtSecret, previousJwtSecret);
}
