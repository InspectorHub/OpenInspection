/**
 * Reads what the Integrations overview needs for ONE company: its settings row,
 * its stored keys (presence only is ever used), whether it has a QuickBooks
 * sign-in, and whether the signed-in person has a Google calendar connected.
 *
 * Every query is scoped by the tenant id the caller took from the verified
 * session. The reads run in parallel and each one fails soft: a table or row
 * that cannot be read reads as "nothing set up", never as "connected".
 */
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { messagingCompliance, qboConnections, tenantConfigs } from '../db/schema';
import { loadTenantSecrets } from '../secrets-cache';
import { memoOnce } from '../request-scope';
import { getCalendarConnection } from '../calendar/connection';
import { coerceEmailByoProvider } from '../email/resolve-provider';
import { parseStoredIntegrationSources } from './stored-sources';
import { deploymentEnvOf } from './deployment-env';
import type { OverviewEnv, OverviewInputs } from './overview';
import type { DeploymentProfile } from '../deployment-profile';

interface LoaderEnv extends OverviewEnv {
    DB: D1Database;
    TENANT_CACHE?: KVNamespace;
    JWT_SECRET: string;
    JWT_SECRET_PREVIOUS?: string;
}

function streamSubdomainOf(integrationConfig: string | null | undefined): string | null {
    if (!integrationConfig) return null;
    try {
        const parsed: unknown = JSON.parse(integrationConfig);
        if (parsed && typeof parsed === 'object') {
            const value = (parsed as Record<string, unknown>).streamCustomerSubdomain;
            return typeof value === 'string' && value.trim() !== '' ? value : null;
        }
    } catch {
        // A corrupt settings blob reads as "no subdomain stored".
    }
    return null;
}

export async function loadOverviewInputs(args: {
    env: LoaderEnv;
    profile: DeploymentProfile;
    tenantId: string;
    userId: string | null;
    /** Names of the keys the integration-secrets middleware took from this company. */
    tenantSecretKeys: readonly string[];
}): Promise<OverviewInputs> {
    const { env, profile, tenantId, userId, tenantSecretKeys } = args;
    const db = drizzle(env.DB);

    const [config, secrets, qbo, calendar, registration] = await Promise.all([
        db.select({
            emailMode: tenantConfigs.emailMode,
            smsMode: tenantConfigs.smsMode,
            videoMode: tenantConfigs.videoMode,
            emailByoProvider: tenantConfigs.emailByoProvider,
            smsByoProvider: tenantConfigs.smsByoProvider,
            senderEmail: tenantConfigs.senderEmail,
            integrationConfig: tenantConfigs.integrationConfig,
        }).from(tenantConfigs).where(eq(tenantConfigs.tenantId, tenantId)).get().catch(() => null),
        // Same cache key as the secrets middleware, so the blob is opened once per request.
        memoOnce(env, `secrets:${tenantId}`, () => loadTenantSecrets(
            env.DB, env.TENANT_CACHE, tenantId, env.JWT_SECRET, env.JWT_SECRET_PREVIOUS,
        )).catch(() => null),
        db.select({ tenantId: qboConnections.tenantId }).from(qboConnections)
            .where(eq(qboConnections.tenantId, tenantId)).get().catch(() => null),
        userId ? getCalendarConnection(env.DB, tenantId, userId).catch(() => null) : Promise.resolve(null),
        db.select({ status: messagingCompliance.complianceStatus, resourceSid: messagingCompliance.messagingResourceSid })
            .from(messagingCompliance).where(eq(messagingCompliance.tenantId, tenantId)).get().catch(() => null),
    ]);

    return {
        profile,
        env: deploymentEnvOf(env, tenantSecretKeys),
        quickbooksConnected: !!qbo,
        calendarConnected: !!calendar,
        company: {
            sources: parseStoredIntegrationSources(config?.integrationConfig),
            legacy: config ? { emailMode: config.emailMode, smsMode: config.smsMode, videoMode: config.videoMode } : undefined,
            emailByoProvider: config ? coerceEmailByoProvider(config.emailByoProvider) : null,
            smsByoProvider: config?.smsByoProvider ?? null,
            senderEmail: config?.senderEmail ?? null,
            streamSubdomain: streamSubdomainOf(config?.integrationConfig),
            ownSecrets: secrets ?? {},
            // Usable once the carrier approved the registration and a Messaging Service exists (what the send gate needs).
            dedicatedNumberReady: registration?.status === 'approved' && !!registration.resourceSid,
        },
    };
}
