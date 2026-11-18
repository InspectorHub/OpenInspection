/**
 * E-2 media route definitions, split from the main data-package router to keep
 * that file under the 400-line ratchet. The handlers live in the main router;
 * these configs are registered there and included in
 * `adminDataPackageRouteConfigs` so the typed client and converted-api-modules
 * gate see them in registration order.
 */
import { createRoute, z } from '@hono/zod-openapi';
import { requireRole } from '../../lib/middleware/rbac';
import { withMcpMetadata } from '../../lib/route-metadata-standards';
import { MediaListResponseSchema } from '../../lib/validations/data-package.schema';

const JobIdParam = z.object({
    id: z.string().describe('Id of the data-package job this request acts on'),
});
const JobTokenHeader = z.object({
    'x-data-job': z.string().describe('Short-lived X-Data-Job token bound to this tenant, job and user'),
});
const MediaListQuery = z.object({
    cursor: z.string().optional().describe('Opaque continuation cursor returned by the previous media page'),
    limit: z.string().optional().describe('Maximum objects in this page, capped by the service ceiling'),
});
const MediaObjectQuery = z.object({
    key: z.string().min(1).describe('R2 object key relative to the tenant prefix, as listed by the media endpoint'),
});

export const mediaRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/data-package/jobs/:id/media', operationId: 'listDataPackageMedia',
    summary: 'List the tenant media objects to export',
    description: 'Lists one page of R2 media objects under the verified tenant prefix, excluding platform-owned exports/migrations/_platform prefixes. Keys are relative to the tenant prefix. Pass the returned cursor back to continue; a malformed cursor restarts the list. Requires a valid X-Data-Job token. Only an owner may call it.',
    tags: ['admin'], middleware: [requireRole('owner')],
    request: { params: JobIdParam, headers: JobTokenHeader, query: MediaListQuery },
    responses: {
        200: { content: { 'application/json': { schema: MediaListResponseSchema } }, description: 'One page of media descriptors' },
        401: { description: 'Invalid X-Data-Job token' },
        409: { description: 'Job is terminal or its lease expired (JOB_LEASE_EXPIRED)' },
    },
}, { scopes: ['admin'], tier: 'extended' }));

export const mediaObjectRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/data-package/jobs/:id/media/object', operationId: 'getDataPackageMediaObject',
    summary: 'Stream one tenant media object, honouring Range',
    description: 'Streams one media object straight from R2 with RFC 9110 Range support (Accept-Ranges, 206 partial, 416 unsatisfiable, no-store). The key is always resolved under the verified tenant prefix, so a key from another tenant can never be read. Requires a valid X-Data-Job token. Only an owner may call it.',
    tags: ['admin'], middleware: [requireRole('owner')],
    request: { params: JobIdParam, headers: JobTokenHeader, query: MediaObjectQuery },
    responses: {
        200: { description: 'The whole object (binary)' },
        206: { description: 'The requested byte range (binary)' },
        416: { description: 'Unsatisfiable Range' },
        401: { description: 'Invalid X-Data-Job token' },
        404: { description: 'Object not found under this tenant' },
        409: { description: 'Job is terminal or its lease expired (JOB_LEASE_EXPIRED)' },
    },
}, { scopes: ['admin'], tier: 'extended' }));
