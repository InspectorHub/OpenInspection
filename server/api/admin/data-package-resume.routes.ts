/**
 * Resume route definition, split from the main data-package router to keep
 * that file under the 400-line ratchet (it already hosts media/web route
 * configs the same way). The handler lives in the main router; this config is
 * registered in `adminDataPackageRouteConfigs` so the typed client and the
 * converted-api-modules gate see it in registration order.
 */
import { createRoute, z } from '@hono/zod-openapi';
import { requireRole } from '../../lib/middleware/rbac';
import { withMcpMetadata } from '../../lib/route-metadata-standards';
import { ResumeResponseSchema } from '../../lib/validations/data-package.schema';

const JobIdParam = z.object({
    id: z.string().describe('Id of the data-package job this request resumes'),
});

export const resumeRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/data-package/jobs/:id/resume', operationId: 'resumeDataPackageJob',
    summary: 'Resume a data-package job after its lease lapses',
    description: 'Reclaims a tenant job whose lease has lapsed and returns a fresh X-Data-Job token. No step-up: the job was already authorized at start, so a still-valid bearer resumes it (an accepted trade-off for multi-hour exports). The job must be younger than 14 days and still active. An optional X-Data-Device-Label is audited when it differs from the recorded lease holder. Only an owner may call it.',
    tags: ['admin'],
    middleware: [requireRole('owner')],
    request: {
        params: JobIdParam,
        headers: z.object({
            'x-data-device-label': z.string().max(128).optional()
                .describe('Non-PII label of the device reclaiming the lease; audited when it differs from the recorded lease holder.'),
        }),
    },
    responses: {
        200: { content: { 'application/json': { schema: ResumeResponseSchema } }, description: 'Job resumed' },
        401: { description: 'Not signed in' },
        404: { description: 'Not this company\'s job' },
        409: { description: 'Job is terminal or too old to resume' },
    },
}, { scopes: ['admin'], tier: 'extended' }));
