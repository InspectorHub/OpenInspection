/**
 * Tenant-scoped usage summary read API.
 *
 * `GET /api/usage/summary` returns the current tenant's cumulative usage
 * across every metered dimension (inspections, sms/email and AI
 * translate/assist — platform and bring-your-own for each — plus the storage
 * gauge and seat usage) and, for a free
 * tenant on a deployment that enforces the free-tier quota (`profile.
 * hasUsageQuota`), the caps those platform metrics are measured against.
 * `caps` is null for every other tenant/deployment — the UI hides progress
 * bars and treats the numbers as pure cumulative counters, matching prior
 * (pre-quota) behavior byte-for-byte.
 *
 * Read-only. Tenant-isolated (filters by the JWT tenantId). `tenantTier` is
 * NOT populated on this JWT-authenticated route (see readTenantTier's own
 * doc comment in features/plan-quota/guard.ts), so the tier is looked up
 * directly rather than read off the context.
 */
import { createRoute } from '@hono/zod-openapi';
import { count, eq } from 'drizzle-orm';
import { createApiRouter } from '../lib/openapi-router';
import { getDrizzle } from '../lib/route-helpers';
import { Errors } from '../lib/errors';
import { withMcpMetadata } from '../lib/route-metadata-standards';
import { MeteringService } from '../services/metering.service';
import { inspections as inspectionsTable } from '../lib/db/schema';
import { getSeatUsage } from '../features/seat-quota';
import { readTenantTier } from '../features/plan-quota/guard';
import { FREE_TIER_CAPS } from '../features/plan-quota/policy';

const summaryRoute = createRoute(withMcpMetadata({
    method:  'get',
    path:    '/summary',
    tags: ['metrics'],
    summary: "Get the current tenant's usage summary (inspections/sms/email/storage/seats + free-tier caps)",
    responses: {
        200: { description: 'Usage summary' },
        401: { description: 'Unauthorized' },
    },
    operationId: 'getUsageSummary',
    description: "Returns the calling tenant's lifetime usage per metric, seat usage, and (free tier only) the caps those metrics are measured against."
}, { scopes: ['read'], tier: 'extended' }));

const usageRoutes = createApiRouter()
    .openapi(summaryRoute, async (c) => {
        const tenantId = c.get('tenantId');
        if (!tenantId) throw Errors.Unauthorized();

        const metering = new MeteringService(c.env.DB);
        const [
            inspections, sms, email, smsByo, emailByo, r2Bytes,
            aiTranslate, aiTranslateByo, aiAssist, aiAssistByo,
            seatUsage, tier,
        ] = await Promise.all([
            metering.lifetimeTotal(tenantId, 'inspections'),
            metering.lifetimeTotal(tenantId, 'sms'),
            metering.lifetimeTotal(tenantId, 'email'),
            metering.lifetimeTotal(tenantId, 'sms_byo'),
            metering.lifetimeTotal(tenantId, 'email_byo'),
            metering.lifetimeTotal(tenantId, 'r2_bytes'),
            // AI is reported platform/bring-your-own separately for the same
            // reason sends are: only platform-funded volume is ever something
            // this deployment could cap.
            metering.lifetimeTotal(tenantId, 'ai_translate'),
            metering.lifetimeTotal(tenantId, 'ai_translate_byo'),
            metering.lifetimeTotal(tenantId, 'ai_assist'),
            metering.lifetimeTotal(tenantId, 'ai_assist_byo'),
            getSeatUsage(tenantId, c.env.DB),
            readTenantTier(c.env.DB, tenantId),
        ]);

        const isFreeTierQuota = tier === 'free' && c.var.profile.hasUsageQuota;

        // The number shown against a cap must be the number the cap is enforced
        // against. `PlanQuotaGuard.consumeInspection` gates on the inspection
        // ROWS a tenant has, and `usage_counters.value` is only a self-healing
        // cache of that — it reads stale-high between a delete and the next
        // create, which would tell a tenant "5 of 5 used" while creating still
        // works. So capped tenants get the live count.
        //
        // Everyone else keeps the cumulative lifetime counter: with `caps: null`
        // it is measured against nothing, and quietly redefining it from "how
        // many they have ever created" to "how many they have now" would change
        // an analytics figure nobody asked to change.
        const inspectionsUsed = isFreeTierQuota
            ? (await getDrizzle(c).select({ n: count() }).from(inspectionsTable)
                .where(eq(inspectionsTable.tenantId, tenantId)).get())?.n ?? 0
            : inspections;

        return c.json({
            success: true as const,
            data: {
                tier,
                caps: isFreeTierQuota ? FREE_TIER_CAPS : null,
                usage: {
                    inspections: inspectionsUsed, sms, email,
                    smsByo, emailByo,
                    aiTranslate, aiTranslateByo,
                    aiAssist, aiAssistByo,
                    seatsUsed: seatUsage.used,
                    seatsMax: seatUsage.max,
                    r2Bytes,
                },
            },
        }, 200);
    });

export type UsageApi = typeof usageRoutes;
export default usageRoutes;
