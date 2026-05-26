/**
 * Secret UI化 — runtime middleware to load encrypted integration secrets
 * from tenant_configs.encrypted_secrets and merge them into c.env.
 *
 * Worker env vars ALWAYS take precedence (backwards compat). DB secrets
 * are the fallback for self-hosted tenants configuring keys via Settings UI.
 *
 * Performance: decryption happens once per request and only if the tenant
 * has a non-null encrypted_secrets value. The result is cached on the
 * request context so multiple accesses to c.env.RESEND_API_KEY etc.
 * don't re-decrypt.
 */
import { MiddlewareHandler } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { tenantConfigs } from '../db/schema';
import { decryptSecrets } from '../config-crypto';
import { HonoConfig } from '../../types/hono';
import { logger } from '../logger';
import { INTEGRATION_SECRET_KEYS } from '../../api/secrets';

export const integrationSecretsMiddleware: MiddlewareHandler<HonoConfig> = async (c, next) => {
    const tenantId = c.get('tenantId') || c.get('resolvedTenantId');
    if (!tenantId) return next();

    // Only decrypt for API routes where the secrets are actually consumed.
    // HTML page renders don't access c.env.RESEND_API_KEY etc., so skip them
    // to avoid an unnecessary D1 query + AES-GCM decrypt on every page load.
    const path = c.req.path;
    if (!path.startsWith('/api/')) return next();

    try {
        const db = drizzle(c.env.DB);
        const row = await db
            .select({ encryptedSecrets: tenantConfigs.encryptedSecrets })
            .from(tenantConfigs)
            .where(eq(tenantConfigs.tenantId, tenantId))
            .get();

        if (row?.encryptedSecrets) {
            const decrypted = await decryptSecrets(row.encryptedSecrets, c.env.JWT_SECRET);

            // Merge into c.env — Worker env takes precedence
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const env = c.env as any;
            for (const key of INTEGRATION_SECRET_KEYS) {
                const dbValue = decrypted[key];
                if (!dbValue) continue;

                // Only fill in if the Worker env binding is empty/undefined
                const envValue = env[key];
                if (!envValue || (typeof envValue === 'string' && envValue.trim() === '')) {
                    env[key] = dbValue;
                }
            }
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
