/**
 * Secret UI化 — runtime middleware to load encrypted integration secrets
 * from tenant_configs.secrets_enc and merge them into c.env.
 *
 * Precedence (A-8 secret-resolution matrix):
 *  - Platform-shared keys (default): Worker env wins; the tenant DB value is a
 *    fallback for self-hosted tenants configuring keys via the Settings UI.
 *  - TENANT_OWNED_KEYS (Stripe Connect): the tenant DB value WINS over env. These
 *    are strictly per-tenant — each inspector collects payments into THEIR OWN
 *    Stripe account, and the platform never registers as a payment entity. If a
 *    stray platform STRIPE_SECRET_KEY env were ever set on the core worker, the
 *    env-wins default would silently route EVERY tenant's homebuyer payments to
 *    the platform account; DB-wins prevents that money-misrouting.
 *
 * Performance: decryption happens once per request and only if the tenant
 * has a non-null secrets_enc value. The result is cached on the
 * request context so multiple accesses to c.env.RESEND_API_KEY etc.
 * don't re-decrypt.
 */
import { MiddlewareHandler } from 'hono';
import { loadTenantSecrets } from '../secrets-cache';
import { HonoConfig } from '../../types/hono';
import { logger } from '../logger';
import { INTEGRATION_SECRET_KEYS } from '../../api/secrets';

/**
 * Strictly per-tenant keys: the tenant's stored value takes precedence over any
 * platform env binding. Stripe is bring-your-own-account (Connect) — a platform
 * env key must never override a tenant's own. See the A-8 matrix.
 */
const TENANT_OWNED_KEYS = new Set<string>([
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'STRIPE_PUBLISHABLE_KEY',
]);

/**
 * Merges a tenant's decrypted DB secrets into the Worker env object IN PLACE,
 * applying the A-8 precedence rule per key. Pure (no I/O) so the precedence
 * policy is unit-testable without D1/Hono. Only known `INTEGRATION_SECRET_KEYS`
 * are considered; empty DB values are ignored.
 */
export function applyIntegrationSecrets(
    env: Record<string, string | undefined>,
    decrypted: Record<string, string | undefined>,
): void {
    for (const key of INTEGRATION_SECRET_KEYS) {
        const dbValue = decrypted[key];
        if (!dbValue) continue;

        const envValue = env[key];
        const envEmpty = !envValue || (typeof envValue === 'string' && envValue.trim() === '');
        // TENANT_OWNED_KEYS: DB wins (the tenant's own Stripe key must beat any
        // platform env). Everyone else: env wins, DB is the self-host fallback.
        if (TENANT_OWNED_KEYS.has(key) || envEmpty) {
            env[key] = dbValue;
        }
    }
}

export const integrationSecretsMiddleware: MiddlewareHandler<HonoConfig> = async (c, next) => {
    const tenantId = c.get('tenantId') || c.get('resolvedTenantId');
    if (!tenantId) return next();

    // Only decrypt for API routes where the secrets are actually consumed.
    // HTML page renders don't access c.env.RESEND_API_KEY etc., so skip them
    // to avoid an unnecessary D1 query + AES-GCM decrypt on every page load.
    const path = c.req.path;
    if (!path.startsWith('/api/')) return next();

    try {
        // A-16 — ciphertext is KV-cached; loadTenantSecrets is the single
        // envelope-aware decrypt entry point (see lib/secrets-cache.ts).
        const decrypted = await loadTenantSecrets(
            c.env.DB, c.env.TENANT_CACHE, tenantId, c.env.JWT_SECRET, c.env.JWT_SECRET_PREVIOUS,
        );
        if (decrypted) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            applyIntegrationSecrets(c.env as any, decrypted as Record<string, string | undefined>);
        }
    } catch (err) {
        // Non-fatal: if decryption fails (key rotation, corrupt data),
        // fall through to env-only mode. Admin can re-enter keys via UI.
        logger.warn('integration-secrets: failed to load', {
            tenantId,
            error: err instanceof Error ? err.message : String(err),
        });
    }

    return next();
};
