import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { requireRole } from '../../lib/middleware/rbac';
import { withMcpMetadata } from '../../lib/route-metadata-standards';
import { servePhotoObject, imagesBinding } from '../../lib/media/serve-photo';
import { resolveReportPhotoKey } from '../../lib/report-link-keys';
import { agentMayReadRepairList } from '../../lib/people/agent-repair-access';
import { releaseGateFor } from '../../lib/report-link-access';
import { getDrizzle } from '../../lib/route-helpers';
import { isReportPublished } from '../../lib/status/report-status';
import { inspections } from '../../lib/db/schema';
import { and, eq } from 'drizzle-orm';

/**
 * GET /api/agent/inspections/:id/photo
 *
 * Defect photos for the agent repair-items page. The staff photo route is
 * owner/manager/inspector-only and the public one wants a portal token, so an
 * agent session satisfies neither. Access here is the agent's referral
 * association (the same predicate the repair-items feed uses) AND the gates the
 * report itself applies to a recipient: the report is published, no agreement or
 * payment hold is outstanding, and the company's repair-list policy for agents
 * (the stricter of the company setting and the agent's role) has not turned the
 * list off. The key must live under the associated tenant + the inspection in
 * the path, whether it is given relative to the company or in full.
 */
const agentPhotoRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/inspections/{id}/photo',
    tags: ['agents'],
    summary: 'Serve a defect photo to an associated agent',
    request: {
        params: z.object({ id: z.string().describe('Inspection id the agent was referred on.') }),
        query: z.object({
            key: z.string().describe('Photo key as the repair items response states it, relative to the company: `inspections/${inspectionId}/...`. The full form `${companyId}/inspections/${inspectionId}/...` is also accepted.'),
            w: z.string().optional().describe('Optional max width in px for an on-the-fly thumbnail.'),
            download: z.string().optional().describe('Set to "1" to force an attachment download.'),
        }),
    },
    responses: {
        200: { content: { 'image/*': { schema: z.any() } }, description: 'Photo bytes' },
        404: { description: 'Not found, or outside this agent\'s referred inspections' },
    },
    security: [{ bearerAuth: [] }],
    operationId: 'serveAgentInspectionPhoto',
    description: "Streams a defect photo from R2 to an agent associated with the inspection. 404 when the agent has no association or the key falls outside that tenant + inspection.",
}, { scopes: ['agent'], tier: 'extended' }));

const app = createApiRouter();
app.openapi(agentPhotoRoute, async (c) => {
    await requireRole('agent')(c, async () => {});
    const user = c.get('user');
    const { id } = c.req.valid('param');
    const { key, w, download } = c.req.valid('query');
    // Association first: an unassociated agent must not even probe the bucket.
    const access = await c.var.services.agent.accessToInspection(user.sub, id);
    if (!access) return c.notFound();
    // The report's own gates, as a recipient meets them: a photo of a report that is withdrawn, held back, or whose repair list the
    // company has switched off for agents is not served.
    if (!agentMayReadRepairList(access.repairAccess)) return c.notFound();
    const row = await getDrizzle(c).select({ reportStatus: inspections.reportStatus }).from(inspections)
        .where(and(eq(inspections.id, id), eq(inspections.tenantId, access.tenantId))).get();
    if (!isReportPublished(row?.reportStatus)) return c.notFound();
    if (await releaseGateFor(c.var.services, id, access.tenantId, false)) return c.notFound();
    // Key scope, resolved against the associated company: one agent cannot name another company's object or another
    // inspection's. Only this inspection's photos are served here, not the company's credential badges.
    const fullKey = resolveReportPhotoKey(key, access.tenantId, id);
    if (fullKey === null || !fullKey.startsWith(`${access.tenantId}/inspections/${id}/`)) return c.notFound();
    const photo = await servePhotoObject(c.env.PHOTOS, imagesBinding(c.env), fullKey, {
        width: w,
        download: download === '1',
    });
    return photo ?? c.notFound();
});

/** Registration order. Drives the typed client; a test pins it to what `app` really registered. */
export const agentPhotoRouteConfigs = [agentPhotoRoute] as const;

export default app;
