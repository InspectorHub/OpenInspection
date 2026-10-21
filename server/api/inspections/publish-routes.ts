// Route definition for POST /{id}/confirm, registered by ./publish.ts. Kept in its own file so publish.ts stays
// under its size cap; the handler and the registration order are in publish.ts.
import { createRoute, z } from '@hono/zod-openapi';
import { requireRole } from '../../lib/middleware/rbac';
import { withMcpMetadata } from '../../lib/route-metadata-standards';
import { SuccessResponseSchema } from '../../lib/validations/shared.schema';
import { guardActOnJob } from './act-guard';
import { guardStaffConfirm } from './staff-status-guards';

export const confirmInspectionRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/{id}/confirm',
    tags: ["inspections"], summary: "Confirm inspection for current tenant",
    middleware: [requireRole('owner', 'manager', 'inspector'), guardActOnJob, guardStaffConfirm] as const,
    request: { params: z.object({ id: z.string().describe('Inspection to confirm.') }) },
    responses: { 200: { content: { 'application/json': { schema: SuccessResponseSchema } }, description: 'Confirmed' } },
    operationId: "confirmInspection",
    description: "Mark an inspection as confirmed: sets its status to confirmed, stamps confirmedAt with the current time and fires the workspace's inspection.confirmed automation rules, which decide whether anyone is notified. Returns 404 when the inspection does not exist and 400 when it is cancelled (uncancel it first). Not idempotent: confirming an already confirmed inspection restamps confirmedAt and fires the automations again. Restricted to owners, managers, inspectors and staff; staff cannot confirm a completed inspection and need scheduleOthers or a place on the inspection. You must be on this inspection or hold the scheduleOthers permission; otherwise 403."
}, { scopes: ['write'], tier: 'extended' }));
