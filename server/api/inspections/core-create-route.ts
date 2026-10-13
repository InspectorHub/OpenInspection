// POST /api/inspections. Split out of core.ts at the file-size ceiling; the
// handler stays beside its siblings in core.ts.
import { createRoute, z } from '@hono/zod-openapi';
import { requireRole } from '../../lib/middleware/rbac';
import { withMcpMetadata } from '../../lib/route-metadata-standards';
import { createApiResponseSchema } from '../../lib/validations/shared.schema';
import { CreateInspectionSchema, InspectionSchema } from '../../lib/validations/inspection.schema';

/**
 * POST /api/inspections
 */
export const createInspectionRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/',
    tags: ["inspections"],
    summary: "Create inspection for current tenant",
    description: "Initialize a new inspection for a property. (POST /, inspections domain).",
    request: {
        body: {
            content: {
                'application/json': {
                    schema: CreateInspectionSchema.describe('Inspection details; an optional client-generated id makes a repeated create return the existing inspection'),
                },
            },
        },
    },
    middleware: [requireRole('owner', 'manager', 'inspector')],
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: createApiResponseSchema(z.object({
                        inspection: InspectionSchema.describe('The inspection that already exists under the supplied id.'),
                    })),
                },
            },
            description: 'Replay of a create that named an id this workspace already holds; nothing new was created',
        },
        201: {
            content: {
                'application/json': {
                    schema: createApiResponseSchema(z.object({
                        inspection: InspectionSchema.describe('The created, or already existing, inspection'),
                    })),
                },
            },
            description: 'Created',
        },
        409: { description: 'ID_CONFLICT: the supplied id already belongs to a record outside this workspace' },
    },
    operationId: "createInspection"
}, { scopes: ['write'], tier: 'primary' }));
