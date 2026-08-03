/**
 * The report ACCESS gate — releasing it, and putting it back.
 *
 * Separate from publish.ts on purpose. Publishing is about whether a document is
 * finished; this is about whether the people waiting for it are allowed to see
 * it. They answer different questions and change for different reasons.
 */
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { requireRole } from '../../lib/middleware/rbac';
import { withMcpMetadata } from '../../lib/route-metadata-standards';
import { createApiResponseSchema } from '../../lib/validations/shared.schema';
import { auditFromContext } from '../../lib/audit';
import { getTenantId } from '../../lib/route-helpers';

/**
 * POST /api/inspections/:id/unlock-report
 *
 * Releases the order-wide report gate for one inspection. Owner/manager only —
 * this hands a client a report the tenant's own rules said to hold, so it is not
 * an inspector-level action.
 */
const unlockReportRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/{id}/unlock-report',
    tags: ['inspections'],
    summary: 'Unlock the report gate for this inspection',
    middleware: [requireRole('owner', 'manager')] as const,
    request: {
        params: z.object({ id: z.string().describe('Inspection id') }),
        body: { content: { 'application/json': { schema: z.object({
            // Required, and deliberately not defaulted. An override with no
            // stated reason is indistinguishable later from a mistake.
            reason: z.string().trim().min(1).max(500)
                .describe('Why this report is being released before the agreement or payment gate is satisfied.'),
        }) } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: createApiResponseSchema(z.object({ unlocked: z.boolean() })) } },
            description: 'Gate released',
        },
    },
    operationId: 'unlockInspectionReport',
    description: 'Releases the agreement/payment gate for every report on this inspection. The gate is order-wide, so this is the way to hand over a finished report that is held back by paperwork attached to something else on the same job. Records who unlocked it and why.',
}, { scopes: ['write'], tier: 'extended' }));

/**
 * POST /api/inspections/:id/relock-report
 * Puts the gate back, clearing the original unlock record.
 */
const relockReportRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/{id}/relock-report',
    tags: ['inspections'],
    summary: 'Restore the report gate for this inspection',
    middleware: [requireRole('owner', 'manager')] as const,
    request: { params: z.object({ id: z.string().describe('Inspection id') }) },
    responses: {
        200: {
            content: { 'application/json': { schema: createApiResponseSchema(z.object({ unlocked: z.boolean() })) } },
            description: 'Gate restored',
        },
    },
    operationId: 'relockInspectionReport',
    description: 'Restores the agreement/payment gate for this inspection and clears the recorded unlock reason.',
}, { scopes: ['write'], tier: 'extended' }));

const reportGateRoutes = createApiRouter()
    .openapi(unlockReportRoute, async (c) => {
        const tenantId = getTenantId(c);
        const { id } = c.req.valid('param');
        const { reason } = c.req.valid('json');
        const userId = c.get('user')?.sub ?? '';
        const { alreadyUnlocked } = await c.var.services.inspection.unlockReportGate(tenantId, id, userId, reason);
        // Audited even when it was already unlocked: someone asked for this, and
        // the attempt is part of the story of who wanted the gate open.
        auditFromContext(c, 'inspection.report_unlocked', 'inspection', {
            entityId: id,
            metadata: { reason, alreadyUnlocked },
        });
        return c.json({ success: true as const, data: { unlocked: true } }, 200);
    })
    .openapi(relockReportRoute, async (c) => {
        const tenantId = getTenantId(c);
        const { id } = c.req.valid('param');
        await c.var.services.inspection.relockReportGate(tenantId, id);
        auditFromContext(c, 'inspection.report_relocked', 'inspection', { entityId: id });
        return c.json({ success: true as const, data: { unlocked: false } }, 200);
    })
;

export default reportGateRoutes;
