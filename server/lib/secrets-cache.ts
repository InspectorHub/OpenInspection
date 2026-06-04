/**
 * A-16 — shared loader for the tenant's canonical encrypted-secrets blob
 * (`tenant_configs.encrypted_secrets`, ENV-name keys, written by
 * PUT/POST /api/admin/secrets).
 *
 * The blob is KV-cached AS CIPHERTEXT (plaintext secrets never land in KV);
 * consumers decrypt per use — AES-GCM on a small blob is sub-millisecond,
 * the D1 round-trip was the cost. `NONE` marks "tenant has no secrets" so
 * those tenants don't re-query D1 every request either. Writers delete the
 * key (see secrets.ts); the TTL bounds staleness for KV's cross-colo
 * eventual consistency.
 *
 * Used by `integrationSecretsMiddleware` (merge into c.env) and
 * `loadTenantEmailConfig` (own-mode Resend key + Gemini BYOK key) — on a
 * typical authed API request the second consumer is a same-request KV hit.
 */
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { tenantConfigs } from './db/schema';

const SECRETS_CACHE_PREFIX = 'intsecrets:';
const SECRETS_CACHE_TTL_S = 300;
const SECRETS_CACHE_NONE = 'NONE';

export function secretsCacheKey(tenantId: string): string {
    return `${SECRETS_CACHE_PREFIX}${tenantId}`;
}

/**
 * Returns the encrypted blob for the tenant, or null when the tenant has no
 * stored secrets. KV-cached; falls back to D1 on miss and repopulates.
 */
export async function loadEncryptedSecretsBlob(
    db: D1Database,
    kv: KVNamespace | undefined,
    tenantId: string,
): Promise<string | null> {
    const cacheKey = secretsCacheKey(tenantId);
    let blob = await kv?.get(cacheKey);

    if (blob === null || blob === undefined) {
        const row = await drizzle(db)
            .select({ encryptedSecrets: tenantConfigs.encryptedSecrets })
            .from(tenantConfigs)
            .where(eq(tenantConfigs.tenantId, tenantId))
            .get();
        blob = row?.encryptedSecrets ?? SECRETS_CACHE_NONE;
        await kv?.put(cacheKey, blob, { expirationTtl: SECRETS_CACHE_TTL_S });
    }

    return blob && blob !== SECRETS_CACHE_NONE ? blob : null;
}
