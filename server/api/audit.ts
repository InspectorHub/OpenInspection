import { createRoute } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { requireRole } from '../lib/middleware/rbac';
import { EntityAuditParamsSchema, EntityAuditQuerySchema, EntityAuditResponseSchema } from '../lib/validations/audit.schema';
import { auditLogs, users } from '../lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { withMcpMetadata } from '../lib/route-metadata-standards';
import { getDrizzle } from '../lib/route-helpers';

// IA-64 — the change-traceability read seam. Templates and comments are company
// assets (schema carries only tenant_id, no created_by), and auditFromContext
// already WRITES template.* / comment.* rows — but nothing ever read them back,
// so "who changed the Roof wording, and when" had no answer in the UI. This
// tenant-scoped endpoint exposes an entity's audit trail (newest first) so the
// list pages can render attribution + an expandable history. It is mounted
// inside the authenticated, tenant-scoped chain, so tenantId comes from the JWT,
// never from the caller.
const auditRoutes = createApiRouter()
    .openapi(createRoute(withMcpMetadata({
        method: 'get',
        path: '/entity/:entityId',
        tags: ['audit'],
        middleware: [requireRole('owner', 'manager')] as const,
        request: {
            params: EntityAuditParamsSchema,
            query: EntityAuditQuerySchema,
        },
        responses: {
            200: { content: { 'application/json': { schema: EntityAuditResponseSchema } }, description: 'Change history for an entity' },
        },
        operationId: 'getEntityAuditTrail',
        summary: 'Change history for a template / comment / entity',
        description: 'Returns the tenant-scoped audit_logs entries for a single entity id, newest first, with the actor name resolved.',
    }, { scopes: ['read'], tier: 'extended' })), async (c) => {
        const tenantId = c.get('tenantId');
        const { entityId } = c.req.valid('param');
        const { limit } = c.req.valid('query');
        const db = getDrizzle(c);

        const rows = await db.select({
            id:        auditLogs.id,
            action:    auditLogs.action,
            actorId:   auditLogs.userId,
            actorName: users.name,
            createdAt: auditLogs.createdAt,
        })
            .from(auditLogs)
            .leftJoin(users, eq(users.id, auditLogs.userId))
            .where(and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.entityId, entityId)))
            .orderBy(desc(auditLogs.createdAt))
            .limit(limit);

        return c.json({
            success: true,
            data: {
                entries: rows.map(r => ({
                    id:        r.id,
                    action:    r.action,
                    actorId:   r.actorId ?? null,
                    actorName: r.actorName ?? null,
                    createdAt: r.createdAt instanceof Date ? r.createdAt.getTime() : Number(r.createdAt),
                })),
            },
        });
    });

export type AuditApi = typeof auditRoutes;
export default auditRoutes;
