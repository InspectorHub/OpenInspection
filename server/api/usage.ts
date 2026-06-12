/**
 * Tenant-scoped usage summary read API.
 *
 * `GET /api/usage/summary` returns the current tenant's cumulative SMS/email
 * counts and latest storage gauge — the figures the /settings/usage page
 * renders. Read-only. Tenant-isolated (filters by the JWT tenantId).
 * Pure aggregation lives in server/lib/usage/aggregate.ts.
 */
import { createRoute } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { usageCounters } from '../lib/db/schema/usage';
import { summariseTenantUsage } from '../lib/usage/aggregate';
import { Errors } from '../lib/errors';
import { withMcpMetadata } from '../lib/route-metadata-standards';

const summaryRoute = createRoute(withMcpMetadata({
    method:  'get',
    path:    '/summary',
    tags: ['metrics'],
    summary: "Get the current tenant's usage summary (sms/email/storage)",
    responses: {
        200: { description: 'Usage summary' },
        401: { description: 'Unauthorized' },
    },
    operationId: 'getUsageSummary',
    description: "Returns the calling tenant's cumulative SMS and email counts plus the latest measured storage bytes."
}, { scopes: ['read'], tier: 'extended' }));

export const usageRoutes = createApiRouter()
    .openapi(summaryRoute, async (c) => {
        const tenantId = c.get('tenantId');
        if (!tenantId) throw Errors.Unauthorized();
        const rows = await drizzle(c.env.DB)
            .select()
            .from(usageCounters)
            .where(eq(usageCounters.tenantId, tenantId))
            .all();
        return c.json({ success: true as const, data: summariseTenantUsage(rows, tenantId) }, 200);
    });

export type UsageApi = typeof usageRoutes;
export default usageRoutes;
