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
            description: 'Replay of a create that named an inspection the caller may open (an owner or manager, or someone assigned to it); nothing new was created, and any step an interrupted first attempt did not reach is completed from this request (roster entry, client and people links, services and their prices, automation notices, audit entry, report and results row)',
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
        503: { description: 'The inspection was saved but its primary report could not be created. Retry the same request; the replay completes the create. (Any other step that fails answers 500, and the same retry applies when a client-generated id was sent.)' },
        409: { description: 'ID_CONFLICT: the supplied id already belongs to a record the caller may not open: one outside this workspace, or an inspection in it the caller is not assigned to. The answer is the same for both, so it does not reveal which' },
    },
    operationId: "createInspection"
}, { scopes: ['write'], tier: 'primary' }));
