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
 * (pre-quota) behavior byte-for-byte. For a capped tenant the allowances renew
 * monthly (UTC): `usage.inspections` and `usage.email` are then this month's
 * figures, and `period` says which month and when it renews.
 *
 * Read-only. Tenant-isolated (filters by the JWT tenantId). `tenantTier` is
 * NOT populated on this JWT-authenticated route (see readTenantTier's own
 * doc comment in features/plan-quota/guard.ts), so the tier is looked up
 * directly rather than read off the context.
 */
import { requireRole } from '../lib/middleware/rbac';
import { createRoute } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import type { ApiOf } from '../lib/api-schema';
import { Errors } from '../lib/errors';
import { withMcpMetadata } from '../lib/route-metadata-standards';
import { MeteringService } from '../services/metering.service';
import { getSeatUsage } from '../features/seat-quota';
import { readTenantTier } from '../features/plan-quota/guard';
import { FREE_TIER_CAPS, allowanceWindow } from '../features/plan-quota/policy';
import { monthInspectionCounts } from '../features/plan-quota/month-usage';
import { currentPeriodKey } from '../lib/usage/period';

const summaryRoute = createRoute(withMcpMetadata({
    method:  'get',
    path:    '/summary',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    tags: ['metrics'],
    summary: "Get the current tenant's usage summary (inspections/sms/email/storage/seats + free-tier caps)",
    responses: {
        200: { description: 'Usage summary' },
        401: { description: 'Unauthorized' },
    },
    operationId: 'getUsageSummary',
    description: "Returns the calling tenant's lifetime usage per metric, seat usage, and (free tier only) the caps those metrics are measured against. On a capped plan the inspections and email figures are for the current UTC calendar month, and `period` ({ period: 'YYYY-MM', resetsAt: ISO instant }) names that month and when its allowance renews; `period` is null when nothing is capped. Available to owner, manager and inspector roles."
}, { scopes: ['read'], tier: 'extended' }));

const app = createApiRouter();
app.openapi(summaryRoute, async (c) => {
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
    const now = new Date();
    const inspectionsUsed = isFreeTierQuota
        ? (await monthInspectionCounts(c.env.DB, now, { tenantId })).get(tenantId) ?? 0
        : inspections;
    // Built-in email is counted per UTC month on the free plan, so the figure shown against its cap is the
    // current month's bucket, not the all-time sum.
    const emailUsed = isFreeTierQuota ? await metering.getCount(tenantId, 'email', currentPeriodKey(now)) : email;

    return c.json({
        success: true as const,
        data: {
            tier,
            caps: isFreeTierQuota ? FREE_TIER_CAPS : null,
            // Which month the capped figures belong to and when they renew; null when nothing is capped.
            period: isFreeTierQuota ? allowanceWindow(now) : null,
            usage: {
                inspections: inspectionsUsed, sms, email: emailUsed,
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

/** Registration order. Drives `UsageApi`; a test pins it to what `app` really registered. */
export const usageRouteConfigs = [
    summaryRoute,
] as const;

export type UsageApi = ApiOf<typeof usageRouteConfigs>;
export default app;
