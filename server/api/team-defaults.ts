import { eq } from 'drizzle-orm';
import { createApiRouter } from '../lib/openapi-router';
import { requireRole } from '../lib/middleware/rbac';
import { tenantConfigs } from '../lib/db/schema';
import { TeamDefaultsSchema } from '../lib/validations/admin.schema';
import { withMcpMetadata } from '../lib/route-metadata-standards';
import { getDrizzle } from '../lib/route-helpers';

/**
 * `/api/team/defaults` — the team page's tenant-level toggles.
 *
 * Split out of `server/api/team.ts` when that file reached its size ceiling.
 * It is the right seam rather than a convenient one: everything else on that
 * router is about WHO is on the team — members, invitations, roles, payroll —
 * while this pair reads and writes a `tenant_configs` column and touches no
 * membership at all. Mounted back at `/` so the public path is unchanged.
 *
 * ⚠️ Nothing calls either of these. A repo-wide search for the paths and the
 * operation ids finds only prose (`lib/tenant-config-write-policy.ts` and the
 * schema's own doc comment). They are recorded here as unwired rather than
 * removed, because a written endpoint with a write policy behind it is a
 * product decision to retire, not a cleanup.
 *
 * `TeamDefaultsSchema` lives in lib/validations/admin/settings.ts: the PUT
 * writes `tenant_configs`, and the write allowlist in
 * lib/tenant-config-write-policy.ts derives the column from that shape.
 */
const teamDefaultsRoutes = createApiRouter()
    /** GET /api/team/defaults — read the team-page toggles. */
    .openapi(withMcpMetadata({
        method: 'get', path: '/defaults',
        operationId: 'getTeamDefaults',
        tags: ['team'],
        summary: "Get tenant team-page default toggles",
        description: "Returns the boolean toggles that govern the team page: teamModeDefault. Used to drive UI state.",
        middleware: [requireRole('owner', 'manager', 'inspector')] as const,
        responses: { 200: { description: 'ok' } },
    }, { scopes: ['read'], tier: 'extended' }), async (c) => {
        const tenantId = c.get('tenantId');
        const db = getDrizzle(c);
        const row = await db.select({
            teamModeDefault:          tenantConfigs.teamModeDefault,
        }).from(tenantConfigs).where(eq(tenantConfigs.tenantId, tenantId)).get();
        return c.json({
            success: true as const,
            data: row ?? {
                teamModeDefault:          false,
            },
        }, 200);
    })
    /** PUT /api/team/defaults — patch any subset of the toggles. */
    .openapi(withMcpMetadata({
        method: 'put', path: '/defaults',
        operationId: 'updateTeamDefaults',
        tags: ['team'],
        summary: "Update tenant team-page default toggles",
        description: "Patches any subset of the team-page toggles (teamModeDefault). Missing keys leave existing values unchanged.",
        middleware: [requireRole('owner', 'manager')] as const,
        request: { body: { content: { 'application/json': { schema: TeamDefaultsSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } } },
        responses: { 200: { description: 'ok' } },
    }, { scopes: ['admin'], tier: 'extended' }), async (c) => {
        const tenantId = c.get('tenantId');
        const body = c.req.valid('json');
        const update: Partial<typeof tenantConfigs.$inferInsert> = {};
        if (body.teamModeDefault          !== undefined) update.teamModeDefault          = body.teamModeDefault;

        if (Object.keys(update).length > 0) {
            await c.var.services.branding.updateBranding(tenantId, update);
        }
        return c.json({ success: true as const, data: { ok: true as const } }, 200);
    });

export type TeamDefaultsApi = typeof teamDefaultsRoutes;

export default teamDefaultsRoutes;
