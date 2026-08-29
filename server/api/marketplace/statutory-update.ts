/**
 * The one statutory-package route that reads rather than writes.
 *
 * Its own sub-router because `marketplace.ts` reached the size ceiling, and
 * because this is the only endpoint on that surface whose answer is a
 * measurement of the workspace's own work rather than a description of the
 * catalogue.
 */
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { requireRole } from '../../lib/middleware/rbac';
import { withMcpMetadata } from '../../lib/route-metadata-standards';
import { getDrizzle } from '../../lib/route-helpers';
import { statutoryUpdateImpact } from '../../services/marketplace/statutory-update-impact';

// What updating a statutory package would cost the inspections already under
// way, read BEFORE the confirmation is shown. Two numbers, and the reassuring
// one is not optional: most in-flight inspections are dated inside the
// superseded revision's window and produce their form exactly as they would
// have. Inspectors may read it -- their inspections are the ones being counted
// -- even though only owner/manager can act on it.
const statutoryUpdateRoutes = createApiRouter()
    .openapi(createRoute(withMcpMetadata({
    method: 'get', path: '/{id}/statutory-update/impact',
    tags: ["marketplace"],
    summary: 'Count the in-progress inspections a statutory package update would affect',
    description: "How many inspections still on this workspace's copy of a statutory template keep producing their form after an update, and how many are dated under the newer revision and therefore cannot produce it at all.",
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: { params: z.object({ id: z.string().describe('The catalogue entry id') }) },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({
                success: z.boolean(),
                data: z.object({
                    total:        z.number().describe('Inspections still on the superseded template, cancelled ones excluded'),
                    producible:   z.number().describe('Of those, the ones whose date sits inside the installed revision window'),
                    blocked:      z.number().describe('Of those, the ones dated under a newer revision, which cannot produce the form'),
                    fromRevision: z.string().nullable().describe('The revision the installed template produces'),
                    toRevision:   z.string().nullable().describe('The revision the catalogue entry produces'),
                }),
            }) } },
            description: 'Update impact',
        },
    },
    operationId: "getMarketplaceStatutoryUpdateImpact",
}, { scopes: ['read'], tier: 'extended' })), async (c) => {
    const { id } = c.req.valid('param');
    // The counter is a free function rather than a service method: it reads and
    // writes nothing, and every surface that asks this question should provably
    // be asking the same one.
    const data = await statutoryUpdateImpact(getDrizzle(c), c.get('tenantId'), id);
    return c.json({ success: true, data }, 200);
});

export default statutoryUpdateRoutes;
