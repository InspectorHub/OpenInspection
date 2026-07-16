import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { tenantConfigs } from '../db/schema';
import { loadTenantSecrets } from '../secrets-cache';
import type { IntegrationConfig } from '../../services/branding.service';

export type GoogleOAuthMode = 'platform' | 'own';

export interface GoogleOAuthCredentials {
    clientId: string;
    clientSecret: string;
}

type ResolveEnv = {
    DB: D1Database;
    TENANT_CACHE: KVNamespace;
    JWT_SECRET: string;
    JWT_SECRET_PREVIOUS?: string;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
};

/** Reads `googleOAuthMode` from tenant integration_config JSON (default platform). */
export async function loadGoogleOAuthMode(db: D1Database, tenantId: string): Promise<GoogleOAuthMode> {
    const row = await drizzle(db)
        .select({ integrationConfig: tenantConfigs.integrationConfig })
        .from(tenantConfigs)
        .where(eq(tenantConfigs.tenantId, tenantId))
        .get();
    if (!row?.integrationConfig) return 'platform';
    try {
        const cfg = JSON.parse(row.integrationConfig) as IntegrationConfig;
        return cfg.googleOAuthMode === 'own' ? 'own' : 'platform';
    } catch {
        return 'platform';
    }
}

async function loadTenantGoogleSecrets(env: ResolveEnv, tenantId: string): Promise<GoogleOAuthCredentials | null> {
    try {
        const dec = await loadTenantSecrets(
            env.DB,
            env.TENANT_CACHE,
            tenantId,
            env.JWT_SECRET,
            env.JWT_SECRET_PREVIOUS,
        );
        const clientId = dec?.GOOGLE_CLIENT_ID?.trim();
        const clientSecret = dec?.GOOGLE_CLIENT_SECRET?.trim();
        if (clientId && clientSecret) {
            return { clientId, clientSecret };
        }
    } catch {
        /* fall through */
    }
    return null;
}

function envGoogleCreds(env: ResolveEnv): GoogleOAuthCredentials | null {
    const clientId = env.GOOGLE_CLIENT_ID?.trim();
    const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
    if (clientId && clientSecret) return { clientId, clientSecret };
    return null;
}

/**
 * Resolves Google OAuth client credentials for calendar flows.
 *
 * - **platform** (SaaS default): Worker env wins; tenant DB is the self-host fallback.
 * - **own**: Tenant encrypted secrets win; env is the fallback when DB is empty.
 */
export async function resolveGoogleOAuthCredentials(
    env: ResolveEnv,
    tenantId: string,
    mode: GoogleOAuthMode,
): Promise<GoogleOAuthCredentials | null> {
    const tenant = await loadTenantGoogleSecrets(env, tenantId);
    const platform = envGoogleCreds(env);
    if (mode === 'own') return tenant ?? platform;
    return platform ?? tenant;
}

/** Whether any Google OAuth client id+secret pair is available (env or tenant DB). */
export async function isGoogleOAuthConfigured(env: ResolveEnv, tenantId: string): Promise<boolean> {
    return !!(await resolveGoogleOAuthCredentials(env, tenantId, 'platform'))
        || !!(await loadTenantGoogleSecrets(env, tenantId));
}
