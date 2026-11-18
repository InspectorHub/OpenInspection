/**
 * E-3 web-facing route definition, split from the main data-package router to
 * keep that file under the 400-line ratchet. The handler lives in the main
 * router; this config is included in `adminDataPackageRouteConfigs` so the
 * typed client and converted-api-modules gate see it in registration order.
 *
 * Cancellation from the web Settings page is bearer-only (a web session has no
 * X-Data-Job token). Like resume, the job is re-scoped by the verified tenant
 * and must still be active; owner role is enforced by the route middleware.
 */
import { createRoute, z } from '@hono/zod-openapi';
import { requireRole } from '../../lib/middleware/rbac';
import { withMcpMetadata } from '../../lib/route-metadata-standards';
import { SimpleResponseSchema } from '../../lib/validations/data-package.schema';

const JobIdParam = z.object({
    id: z.string().describe('Id of the data-package job this request cancels'),
});

export const cancelJobRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/data-package/jobs/:id/cancel', operationId: 'cancelDataPackageJob',
    summary: 'Cancel a data-package job from the web settings page',
    description: 'Cancels a still-active job and frees its lease. Bearer-only: a web session has no X-Data-Job token, so the job is re-scoped by the verified tenant (404 when it is not this company\'s job) and must be queued or running. Only an owner may call it.',
    tags: ['admin'], middleware: [requireRole('owner')],
    request: { params: JobIdParam },
    responses: {
        200: { content: { 'application/json': { schema: SimpleResponseSchema } }, description: 'Job cancelled' },
        401: { description: 'Not signed in' },
        404: { description: 'Not this company\'s job' },
        409: { description: 'Job is terminal (cancelled/complete/expired/failed)' },
    },
}, { scopes: ['admin'], tier: 'extended' }));
