import { createRoute, z } from '@hono/zod-openapi';
import { withMcpMetadata } from '../lib/route-metadata-standards';

/**
 * Route definitions for the client-portal message routes (mounted at /api/public). The caller authenticates with a
 * portal session or a per-inspection token inside the handler, so no route declares `security`, and none is exposed
 * to MCP. The send body is not declared as a request schema: the handler checks the actor first and only then parses
 * the body, and a validator in front of it would answer a bad body before the 401.
 */
const idParam = z.object({ id: z.string().describe('Id of the inspection whose conversation is addressed.') });
const errorBody = (what: string) => ({ content: { 'application/json': { schema: z.object({ error: z.string().describe('Short message saying what went wrong.') }) } }, description: what });

export const clientMessageListRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/inspections/{id}/messages', tags: ['messages', 'public'],
    request: { params: idParam },
    responses: {
        200: { content: { 'application/json': { schema: z.object({
            success: z.literal(true).describe('Always true on success.'),
            data: z.array(z.any()).describe('The messages in the caller thread, oldest first.'),
        }) } }, description: 'The caller thread' },
        401: errorBody('No valid client grant for the inspection'),
    },
    operationId: 'listClientMessages', summary: 'List the client conversation for an inspection',
    description: 'Client-portal read of the message thread between the caller and the inspector, oldest first. It marks the staff messages in that thread read. The caller authenticates with a portal session or a per-inspection token inside the handler, not with a staff session.',
}, { scopes: [], tier: 'excluded' }));

export const clientMessageSendRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/inspections/{id}/messages', tags: ['messages', 'public'],
    request: { params: idParam },
    responses: {
        201: { content: { 'application/json': { schema: z.object({
            success: z.literal(true).describe('Always true on success.'),
            data: z.any().describe('The created message row.'),
        }) } }, description: 'Created message' },
        400: errorBody('The JSON body is not a valid message'),
        401: errorBody('No valid client grant for the inspection'),
        403: errorBody('The caller has no client seat on this inspection'),
    },
    operationId: 'sendClientMessage', summary: 'Send a message as the client',
    description: 'Client-portal send of one message into the caller thread; the inspector is notified by email. The JSON body is {body, attachments?}: body is 1 to 5000 characters and attachments holds at most 5 descriptors from the upload route. The caller authenticates with a portal session or a per-inspection token inside the handler, not with a staff session.',
}, { scopes: [], tier: 'excluded' }));
