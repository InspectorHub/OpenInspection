import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { requireRole } from '../../lib/middleware/rbac';
import { withMcpMetadata } from '../../lib/route-metadata-standards';
import { servePhotoObject, imagesBinding } from '../../lib/media/serve-photo';

/**
 * GET /api/agent/inspections/:id/photo
 *
 * Defect photos for the agent repair-items page. The staff photo route is
 * owner/manager/inspector-only and the public one wants a portal token, so an
 * agent session satisfies neither. Access here is exactly the agent's referral
 * association (the same predicate the repair-items feed uses) and never wider:
 * the key must live under the associated tenant + the inspection in the path.
 */
const agentPhotoRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/inspections/{id}/photo',
    tags: ['agents'],
    summary: 'Serve a defect photo to an associated agent',
    request: {
        params: z.object({ id: z.string().describe('Inspection id the agent was referred on.') }),
        query: z.object({
            key: z.string().describe('R2 object key (`${tenantId}/inspections/${inspectionId}/...`).'),
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

const agentPhotoRoutes = createApiRouter()
    .openapi(agentPhotoRoute, async (c) => {
        await requireRole('agent')(c, async () => {});
        const user = c.get('user');
        const { id } = c.req.valid('param');
        const { key, w, download } = c.req.valid('query');
        // Association first: an unassociated agent must not even probe the bucket.
        const access = await c.var.services.agent.accessToInspection(user.sub, id);
        if (!access) return c.notFound();
        // Key scope. Without this an associated agent could read any object in
        // any tenant by passing someone else's key.
        if (!key.startsWith(`${access.tenantId}/inspections/${id}/`)) return c.notFound();
        const photo = await servePhotoObject(c.env.PHOTOS, imagesBinding(c.env), key, {
            width: w,
            download: download === '1',
        });
        return photo ?? c.notFound();
    });

export default agentPhotoRoutes;
