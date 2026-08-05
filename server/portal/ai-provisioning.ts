import type { Context } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import type { HonoConfig } from '../types/hono';
import { tenants } from '../lib/db/schema';
import { logger } from '../lib/logger';
import { loadTenantSecrets } from '../lib/secrets-cache';
import { resolveRuntimeAiSource } from '../lib/ai/metering';
import { getDeploymentProfile } from '../lib/deployment-profile';

/**
 * GET /api/integration/ai-provisioning — AI provisioning status for portal's
 * tier-quota console (managed-ai Task 5 follow-up (a)).
 *
 * Per tier, how many tenants would resolve to managed / BYO / unconfigured
 * credentials RIGHT NOW. The bucketing is `resolveRuntimeAiSource` — the same
 * `resolveAi` call, with the same still-false entitlement literal, that tags
 * the usage meter — so this endpoint cannot drift from what the runtime would
 * actually do (portal deliberately stores nothing and asks on every read).
 *
 * Wire contract (pinned by portal's `narrowAiProvisioning`): a tier with no
 * tenants is ABSENT from `tiers`, never a zeroed row — portal renders absent
 * as "core did not mention it". All three counts are finite numbers. The
 * managed bucket is 0 everywhere until entitlement ships; that is the truth,
 * not a gap.
 *
 * Cost note: one secrets read (KV-cached ciphertext + decrypt) per tenant per
 * request. This is a console read, not a hot path; revisit only if tenant
 * count makes it one.
 */
export async function aiProvisioningHandler(c: Context<HonoConfig>) {
    try {
        const profile = getDeploymentProfile(c.env);
        const managedKey = c.env.AI_MANAGED_API_KEY ?? null;
        const model = c.env.AI_MODEL ?? '';
        const rows = await drizzle(c.env.DB)
            .select({ id: tenants.id, tier: tenants.tier })
            .from(tenants)
            .all();

        const tiers: Record<string, { managed: number; byo: number; unconfigured: number }> = {};
        for (const t of rows) {
            // Undecryptable/absent secrets → no tenant key, exactly as the
            // runtime email/AI construction treats it (loadEmailSecrets
            // swallows the same throw): the tenant resolves unconfigured
            // rather than failing the whole report.
            const dec = await loadTenantSecrets(
                c.env.DB, c.env.TENANT_CACHE, t.id as string, c.env.JWT_SECRET, c.env.JWT_SECRET_PREVIOUS,
            ).catch(() => null);
            const source = resolveRuntimeAiSource({
                profile,
                tenantKey: dec?.GEMINI_API_KEY || null,
                managedKey,
                model,
            });
            const tier = t.tier as string;
            const bucket = (tiers[tier] ??= { managed: 0, byo: 0, unconfigured: 0 });
            bucket[source ?? 'unconfigured'] += 1;
        }

        return c.json({ success: true, data: { tiers } });
    } catch (error: unknown) {
        logger.error('ai-provisioning read failed', {}, error instanceof Error ? error : undefined);
        return c.json({ success: false, error: { message: 'Internal server error' } }, 500);
    }
}
