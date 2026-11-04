/**
 * "Edit and republish": the way back into a published report.
 *
 * A published report takes no content edits (409 `REPORT_PUBLISHED`, see `lib/inspection/report-lock`). This is the
 * explicit step that lifts the lock. It is NOT a retract: nothing is withdrawn, no link expires, and clients keep
 * reading the latest published version while the inspector edits. Publishing again freezes the next version.
 *
 * Separate from publish.ts, which also carries the retract (`unpublish`): the two are opposite promises to a client
 * ("still there, being revised" versus "taken back"), and they change for different reasons.
 */
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { requireRole } from '../../lib/middleware/rbac';
import { requireCapability } from '../../lib/middleware/require-capability';
import { withMcpMetadata } from '../../lib/route-metadata-standards';
import { createApiResponseSchema } from '../../lib/validations/shared.schema';
import { auditFromContext } from '../../lib/audit';
import { getDrizzle, getTenantId } from '../../lib/route-helpers';
import { setCollabDocLocks } from '../../lib/collab/doc-lock-notify';
import { guardActOnJob } from './act-guard';

const editAgainRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/{id}/edit-again',
    tags: ['inspections'],
    summary: 'Edit a published report again (Edit and republish)',
    middleware: [requireRole('owner', 'manager', 'inspector'), requireCapability('publish'), guardActOnJob] as const,
    request: {
        params: z.object({ id: z.string().describe('Inspection id') }),
        body: { content: { 'application/json': { schema: z.object({
            reportId: z.string().optional().describe('Which report to open for editing. Absent: the inspection\'s primary report.'),
        }) } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: createApiResponseSchema(z.object({
                reportId: z.string().describe('The report that is open for editing.'),
                state: z.literal('editing').describe('The report is being edited; clients still see its latest published version.'),
            })) } },
            description: 'The report is open for editing',
        },
        400: { description: 'The report is not published, so there is nothing to unlock' },
        403: { description: 'Missing publish capability, or not on this inspection' },
        404: { description: 'No such report on this inspection' },
    },
    operationId: 'editPublishedReportAgain',
    description: 'Lifts the publish lock on one report so its content can be changed again: until then every content write answers 409 REPORT_PUBLISHED. The report is NOT withdrawn: no client link expires, nothing is sent, and clients keep reading the latest published version until a new publish freezes the next one. Use the unpublish route to withdraw a report instead. Calling it on a report that is already being edited again answers the same 200. An inspection with no report row (not yet backfilled) answers 404, as the collaborative editor does. Requires the publish capability, like publishing. You must be on this inspection or hold the scheduleOthers permission; otherwise 403.',
}, { scopes: ['write'], tier: 'extended', capability: 'publish' }));

const app = createApiRouter();
app.openapi(editAgainRoute, async (c) => {
    const tenantId = getTenantId(c);
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const reportId = await c.var.services.inspection.reopenReport(id, tenantId, body.reportId);
    // Documents that were told the report was published accept sockets again. Never fails the request.
    await setCollabDocLocks(c.env, getDrizzle(c), tenantId, id, false, { reportId });
    auditFromContext(c, 'inspection.report_reopened', 'inspection', { entityId: id, metadata: { reportId } });
    return c.json({ success: true as const, data: { reportId, state: 'editing' as const } }, 200);
});

/** Registration order. Drives the typed client; a test pins it to what `app` really registered. */
export const reportReopenRouteConfigs = [editAgainRoute] as const;

export default app;
