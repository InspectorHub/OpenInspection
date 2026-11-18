/**
 * Large-blob column chunk route definition, split from the main data-package
 * router to keep that file under the 400-line ratchet (the media/web/resume
 * route configs are split the same way). The handler lives in the main router;
 * this config is included in `adminDataPackageRouteConfigs` so the typed client
 * and the converted-api-modules gate see it in registration order.
 */
import { createRoute, z } from '@hono/zod-openapi';
import { requireRole } from '../../lib/middleware/rbac';
import { withMcpMetadata } from '../../lib/route-metadata-standards';

const ColumnChunkParam = z.object({
    id: z.string().describe('Id of the data-package job this request acts on'),
    table: z.string().describe('Exportable table whose blob column is being read'),
    rowKey: z.string().describe('Opaque row key cursor identifying the row, as returned by the rows endpoint'),
    column: z.string().describe('Whitelisted large blob column to read a byte slice of'),
});
const JobTokenHeader = z.object({
    'x-data-job': z.string().describe('Short-lived X-Data-Job token bound to this tenant, job and user'),
});
const ChunkQuery = z.object({
    offset: z.string().regex(/^\d+$/).describe('Byte offset at which the chunk begins, zero based'),
    len: z.string().regex(/^\d+$/).describe('Maximum number of bytes to return in this chunk'),
});

export const columnChunkRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/data-package/jobs/:id/tables/:table/rows/:rowKey/columns/:column',
    operationId: 'readDataPackageColumnChunk',
    summary: 'Read a byte slice of a large blob column',
    description: 'Reads one byte slice of a whitelisted large blob column from a single row, using SQL substr() on a BLOB cast. The row is addressed by the opaque keyset cursor returned by the rows endpoint; the column must be one the table descriptor lists as a blob column, so no arbitrary column can be read. Intended as the escape hatch for rows too large for one page. Only an owner may call it.',
    tags: ['admin'], middleware: [requireRole('owner')],
    request: { params: ColumnChunkParam, headers: JobTokenHeader, query: ChunkQuery },
    responses: {
        200: {
            description: 'The byte slice (binary). X-Total-Bytes is the full column length; X-Next-Offset, when present, is the offset for the next slice.',
            headers: {
                'x-total-bytes': { schema: { type: 'string' }, description: 'Total byte length of the column value' },
                'x-next-offset': { schema: { type: 'string' }, description: 'Byte offset of the next chunk, or absent when this is the last' },
            },
        },
        400: { description: 'Invalid row key cursor, offset or length' },
        401: { description: 'Invalid X-Data-Job token' },
        404: { description: 'Table, column or row not part of this tenant data package' },
        409: { description: 'Job is terminal or its lease expired (JOB_LEASE_EXPIRED)' },
    },
}, { scopes: ['admin'], tier: 'extended' }));
