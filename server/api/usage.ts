/**
 * Tenant-scoped usage summary read API.
 *
 * `GET /api/usage/summary` returns the current tenant's cumulative usage
 * across every metered dimension (inspections, sms/email — platform and
 * bring-your-own — plus the storage gauge and seat usage) and, for a free
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
import { createApiRouter } from '../lib/openapi-router';
import { Errors } from '../lib/errors';
import { withMcpMetadata } from '../lib/route-metadata-standards';
import { MeteringService } from '../services/metering.service';
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
        const [inspections, sms, email, smsByo, emailByo, r2Bytes, seatUsage, tier] = await Promise.all([
            metering.lifetimeTotal(tenantId, 'inspections'),
            metering.lifetimeTotal(tenantId, 'sms'),
            metering.lifetimeTotal(tenantId, 'email'),
            metering.lifetimeTotal(tenantId, 'sms_byo'),
            metering.lifetimeTotal(tenantId, 'email_byo'),
            metering.lifetimeTotal(tenantId, 'r2_bytes'),
            getSeatUsage(tenantId, c.env.DB),
            readTenantTier(c.env.DB, tenantId),
        ]);

        const isFreeTierQuota = tier === 'free' && c.var.profile.hasUsageQuota;

        return c.json({
            success: true as const,
            data: {
                tier,
                caps: isFreeTierQuota ? FREE_TIER_CAPS : null,
                usage: {
                    inspections, sms, email,
                    smsByo, emailByo,
                    seatsUsed: seatUsage.used,
                    seatsMax: seatUsage.max,
                    r2Bytes,
                },
            },
        }, 200);
    });

export type UsageApi = typeof usageRoutes;
export default usageRoutes;
