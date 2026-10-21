// Route definitions for POST /{id}/agent-token and POST /{id}/share-agent, registered by ./report-delivery.ts. Kept in
// their own file so report-delivery.ts stays under its size cap; the handlers and the registration order are there.
import { createRoute, z } from '@hono/zod-openapi';
import { requireRole } from '../../lib/middleware/rbac';
import { createApiResponseSchema } from '../../lib/validations/shared.schema';
import { withMcpMetadata } from '../../lib/route-metadata-standards';
import { guardReportLink } from './report-send-guards';

export const agentTokenRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/{id}/agent-token',
    tags: ["inspections"],
    summary: 'Generate shareable agent view token',
    middleware: [requireRole('owner', 'manager', 'inspector'), guardReportLink] as const,
    request: { params: z.object({ id: z.string().describe('Inspection the agent view link is for.') }) },
    responses: {
        200: {
            content: { 'application/json': { schema: createApiResponseSchema(z.object({ token: z.string().describe('The newly minted agent view token, also embedded in the url field.'), url: z.string().describe('Full report URL ending in the agent view query string, ready to share with the agent.') })) } },
            description: 'Agent view token and URL',
        },
    },
    operationId: "createInspectionAgentToken",
    description: "Mint a read-only agent view link for an inspection report. Stores a new token that expires after 30 days and returns it with the full report URL (?view=agent&token=...). Nothing is sent: the caller delivers the link. Every call mints a new token and earlier tokens keep working until they expire. Returns 404 for an unknown inspection. Restricted to owners and managers, and to inspectors assigned to the inspection or granted the scheduleOthers capability; the report must be published (409 NOT_PUBLISHED otherwise)."
}, { scopes: ['write'], tier: 'extended' }));

export const shareAgentRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/{id}/share-agent',
    tags: ["inspections"],
    summary: 'Email the report share link to the linked agent',
    middleware: [requireRole('owner', 'manager', 'inspector'), guardReportLink] as const,
    request: { params: z.object({ id: z.string().describe('Inspection whose report link is emailed to the buyer agent.') }) },
    responses: {
        200: {
            content: { 'application/json': { schema: createApiResponseSchema(z.object({ sentTo: z.string().describe('Email address of the buyer agent the report link was sent to.') })) } },
            description: 'Share link emailed to agent',
        },
    },
    operationId: "createInspectionShareAgent",
    description: "Email the report link to the inspection's buyer agent. Mints a new agent view token (valid 30 days), builds the agent view URL and sends it to the email on the buyer agent contact, with the inspector's signature appended, then writes an inspection.share_agent audit entry. Returns 400 when no buyer agent is linked to the inspection or that contact has no email, 404 for an unknown inspection and 500 if the email fails to send. Each call sends another email with a new token. Restricted to owners and managers, and to inspectors assigned to the inspection or granted the scheduleOthers capability; the report must be published (409 NOT_PUBLISHED otherwise)."
}, { scopes: ['write'], tier: 'extended' }));
