/**
 * Where one tenant's QuickBooks credentials come from, in a context with no
 * middleware.
 *
 * `integrationSecretsMiddleware` merges a tenant's encrypted secrets into
 * `c.env`, and it returns early for any path that does not start `/api/`. Cron
 * has no Hono chain at all, so a sweep that reads `env.QBO_CLIENT_ID` directly
 * sees the PLATFORM credential or nothing — and under `qboAppManaged: false` a
 * self-hosted operator has nowhere to put a credential except the tenant row.
 * That is how a connection could work in the browser, read "Active" in
 * Settings, and never once sync.
 *
 * The precedence rule is NOT restated here. `applyIntegrationSecrets` owns it
 * (env wins; the tenant row is the self-host fallback; `TENANT_OWNED_KEYS`
 * inverts it for Stripe so a stray platform key cannot route an inspector's
 * homebuyer payments into the platform account). A second copy of a precedence
 * rule is exactly how the OAuth callback's guard came to disagree with it.
 */
import { loadTenantSecrets } from '../../lib/secrets-cache';
import { applyIntegrationSecrets } from '../../lib/middleware/integration-secrets';

export interface QboCredentials {
    clientId: string;
    clientSecret: string;
    webhookSecret: string;
    /**
     * Passed through as-is, including `undefined`. `resolveQboApiBase` raises on
     * an unset value rather than guessing a host, and that refusal is the point:
     * Development keys authenticate only against sandbox companies and
     * Production keys only against real ones, so a default is wrong half the
     * time and fails in a way that reads like a bad secret.
     */
    qboEnv: string | undefined;
}

export interface QboCredentialResolution {
    credentials: QboCredentials | null;
    /** Which required keys resolved to nothing. Empty when `credentials` is set. */
    missing: string[];
}

/** The two without which no call can be made. `QBO_ENV` fails later, and louder. */
const REQUIRED_KEYS = ['QBO_CLIENT_ID', 'QBO_CLIENT_SECRET'] as const;

export async function resolveQboCredentialsForTenant(
    env: {
        DB: D1Database;
        TENANT_CACHE?: KVNamespace;
        JWT_SECRET?: string;
        JWT_SECRET_PREVIOUS?: string;
        QBO_CLIENT_ID?: string;
        QBO_CLIENT_SECRET?: string;
        QBO_WEBHOOK_SECRET?: string;
        QBO_ENV?: string;
    },
    tenantId: string,
): Promise<QboCredentialResolution> {
    const merged: Record<string, string | undefined> = {
        QBO_CLIENT_ID:      env.QBO_CLIENT_ID,
        QBO_CLIENT_SECRET:  env.QBO_CLIENT_SECRET,
        QBO_WEBHOOK_SECRET: env.QBO_WEBHOOK_SECRET,
        QBO_ENV:            env.QBO_ENV,
    };

    // Swallowed on purpose, and only here: one tenant whose envelope cannot be
    // opened must not stop the sweep for every other tenant. The caller reports
    // the skip by name, so the failure is visible without being fatal.
    if (env.JWT_SECRET) {
        const decrypted = await loadTenantSecrets(
            env.DB, env.TENANT_CACHE, tenantId, env.JWT_SECRET, env.JWT_SECRET_PREVIOUS,
        ).catch(() => null);
        if (decrypted) applyIntegrationSecrets(merged, decrypted);
    }

    const missing = REQUIRED_KEYS.filter((k) => !merged[k]);
    if (missing.length > 0) return { credentials: null, missing: [...missing] };

    return {
        credentials: {
            clientId:      merged.QBO_CLIENT_ID!,
            clientSecret:  merged.QBO_CLIENT_SECRET!,
            webhookSecret: merged.QBO_WEBHOOK_SECRET ?? '',
            qboEnv:        merged.QBO_ENV,
        },
        missing: [],
    };
}
