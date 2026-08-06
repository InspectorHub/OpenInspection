import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { tenantConfigs, tenants } from '../../lib/db/schema';
import type { AiCappedMetric, AiTierCaps } from './policy';

/**
 * Where a DELIVERED AI allowance lives on the core side, and the only two
 * functions that touch it.
 *
 * The numbers are owned by portal's tier console (which records who set them
 * and when) and reach core as per-tenant commands — the command queue is
 * per-tenant by construction, so a tier cap arrives fanned out, one envelope
 * per tenant, carrying the tier it was computed for.
 *
 * Storage is `tenant_configs.integration_config`, the existing per-tenant JSON
 * config blob, under a reserved key. Two properties of that column make it
 * safe to share, and both are load-bearing:
 *   1. The tenant-facing writer (`BrandingService.updateIntegrationConfig`)
 *      MERGES over the stored object, so a Settings save cannot drop a key it
 *      does not know about.
 *   2. The tenant-facing route validates its body against a closed Zod object
 *      (`IntegrationConfigSchema` in api/admin/admin-config.ts), which STRIPS
 *      unknown keys — so a tenant cannot write their own allowance.
 * `tests/unit/usage/ai-caps-storage.spec.ts` asserts both; if either changes,
 * this key needs a different home rather than a bigger comment.
 *
 * No cap constant appears in this file. An absent key, an absent tier, an
 * absent metric and an unparseable blob all mean the same thing — nothing is
 * configured, so nothing is enforced (see `PlanQuotaGuard.checkAiQuota`).
 */

/** Reserved key inside `tenant_configs.integration_config`. */
export const AI_CAPS_CONFIG_KEY = 'platformAiCaps';

/** The metrics a cap can be expressed against, as data. Anything else that
 *  arrives is dropped: a metric this build cannot enforce must not be stored
 *  as though it could be. */
const CAPPED_METRICS: readonly AiCappedMetric[] = ['ai_translate', 'ai_assist'];

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A cap is a non-negative integer. `0` is a real value ("no managed AI for
 *  this tier"), which is why the check is on finiteness and sign, not truth. */
function isCapValue(v: unknown): v is number {
    return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

/** Narrow an arbitrary stored/delivered value to the caps the guard can read.
 *  Tolerant: unknown tiers pass through (tiers are open-ended strings), unknown
 *  metrics and malformed numbers are dropped, and a tier left with no metrics
 *  is dropped with them. Returns undefined when nothing survives — the
 *  "unconfigured" state, which must not be representable as an empty object
 *  that a caller might read as "configured to nothing". */
export function narrowAiTierCaps(raw: unknown): AiTierCaps | undefined {
    if (!isRecord(raw)) return undefined;
    const out: Record<string, Partial<Record<AiCappedMetric, number>>> = {};
    for (const [tier, metrics] of Object.entries(raw)) {
        if (!isRecord(metrics)) continue;
        const kept: Partial<Record<AiCappedMetric, number>> = {};
        for (const metric of CAPPED_METRICS) {
            const value = metrics[metric];
            if (isCapValue(value)) kept[metric] = value;
        }
        if (Object.keys(kept).length > 0) out[tier] = kept;
    }
    return Object.keys(out).length > 0 ? out : undefined;
}

function parseConfig(raw: string | null | undefined): Record<string, unknown> {
    if (!raw) return {};
    try {
        const parsed: unknown = JSON.parse(raw);
        return isRecord(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

/** The caps configured for a tenant, or undefined when none are. */
export async function readTenantAiCaps(db: D1Database, tenantId: string): Promise<AiTierCaps | undefined> {
    const row = await drizzle(db)
        .select({ integrationConfig: tenantConfigs.integrationConfig })
        .from(tenantConfigs)
        .where(eq(tenantConfigs.tenantId, tenantId))
        .get();
    return narrowAiTierCaps(parseConfig(row?.integrationConfig)[AI_CAPS_CONFIG_KEY]);
}

/** The loader shape `PlanQuotaGuard` takes: resolution is deferred to the
 *  moment an AI quota is actually checked, so the guard's construction sites
 *  — one of which runs on every authenticated request, and one of which is
 *  reused across every tenant in a cron tick — pay no read for it and none of
 *  them can bind one tenant's caps to another tenant's check. */
export function tenantAiCapsLoader(db: D1Database): (tenantId: string) => Promise<AiTierCaps | undefined> {
    return (tenantId: string) => readTenantAiCaps(db, tenantId);
}

/**
 * Replace a tenant's stored caps with `caps` (undefined clears them).
 *
 * Whole-set replacement, not a merge: the delivered command carries the
 * complete set the tenant should have, so clearing a cap needs no tombstone.
 * The surrounding `integration_config` object IS merged — everything else in
 * that column belongs to the tenant.
 *
 * Returns 'tenant-not-found' when the tenant row is absent; the caller decides
 * whether that is a retry (the caps raced ahead of the tenant upsert) or not.
 */
export async function writeTenantAiCaps(
    db: D1Database,
    tenantId: string,
    caps: AiTierCaps | undefined,
): Promise<'applied' | 'tenant-not-found'> {
    const d = drizzle(db);
    const tenant = await d.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId)).get();
    if (!tenant) return 'tenant-not-found';

    const row = await d.select({ integrationConfig: tenantConfigs.integrationConfig })
        .from(tenantConfigs).where(eq(tenantConfigs.tenantId, tenantId)).get();
    const config = parseConfig(row?.integrationConfig);
    if (caps) config[AI_CAPS_CONFIG_KEY] = caps;
    else delete config[AI_CAPS_CONFIG_KEY];

    const serialized = Object.keys(config).length > 0 ? JSON.stringify(config) : null;
    const now = new Date();
    await d.insert(tenantConfigs)
        .values({ tenantId, integrationConfig: serialized, updatedAt: now })
        .onConflictDoUpdate({
            target: tenantConfigs.tenantId,
            set: { integrationConfig: serialized, updatedAt: now },
        });
    return 'applied';
}
