/**
 * Company inbox routes (Track D, design §3.9) — mounted at /api/messages
 * beside the unread-count summary. Threads are contact-keyed, so the
 * company-wide Conversations view is `WHERE contact_id` over the same table
 * the per-inspection view reads. Split from messages.ts purely for file size;
 * the router composes back into the same mount and the same typed client.
 */
import { createRoute } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { z } from '@hono/zod-openapi';
import { requireRole } from '../lib/middleware/rbac';
import { Errors } from '../lib/errors';
import { withMcpMetadata } from '../lib/route-metadata-standards';

// ── Company inbox routes (Track D, design §3.9) — mounted at /api/messages ────
// Threads are contact-keyed, so the company-wide Conversations view is
// `WHERE contact_id` over the same table the per-inspection view reads.

const listThreadsRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/threads',
    tags: ['messages'],
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    responses: {
        200: { content: { 'application/json': { schema: z.object({
            success: z.literal(true),
            data: z.array(z.object({
                contactId: z.string().describe('Thread key — the counterparty contact.'),
                contactName: z.string().nullable().describe('Contact display name; null if the contact row was deleted.'),
                contactEmail: z.string().nullable().describe('Contact email.'),
                lastBody: z.string().describe("The thread's newest message text (snippet source)."),
                lastFromRole: z.string().describe('Who wrote the newest message.'),
                lastAt: z.number().describe('Epoch-ms of the newest message.'),
                unread: z.number().describe('Unread counterparty-authored messages in this thread.'),
            })).describe('One row per contact thread, newest activity first.'),
        }) } }, description: 'OK' },
    },
    operationId: 'listMessageThreads',
    summary: 'Company-wide message inbox: one row per contact thread',
    description: 'Per-contact thread summaries across every inspection and the no-inspection outreach rows, newest activity first.',
}, { scopes: ['read'], tier: 'extended' }));

const getThreadRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/threads/{contactId}',
    tags: ['messages'],
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: { params: z.object({ contactId: z.string().min(1).describe('Contact whose thread to read.') }) },
    responses: {
        200: { content: { 'application/json': { schema: z.object({
            success: z.literal(true),
            data: z.object({
                contact: z.object({ contactId: z.string(), name: z.string().nullable(), email: z.string().nullable() }),
                messages: z.array(z.any()).describe('Full thread oldest-first, each row carrying propertyAddress when an inspection is attached.'),
            }),
        }) } }, description: 'OK' },
        404: { description: 'Contact not found in this tenant' },
    },
    operationId: 'getMessageThread',
    summary: "One contact's full thread (marks it read)",
    description: "Every message with this contact — across inspections and the rows with no inspection attached — oldest first. Reading it marks the thread's counterparty messages read.",
}, { scopes: ['read'], tier: 'extended' }));

const sendThreadRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/threads/{contactId}',
    tags: ['messages'],
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({ contactId: z.string().min(1).describe('Contact whose thread to post into.') }),
        body: { content: { 'application/json': { schema: z.object({
            body: z.string().min(1).max(5000).describe('Message text.'),
            inspectionId: z.string().optional().describe('Optional inspection mention — the nullable inspection_id column with a value, nothing more. No parser, no separate mention table.'),
        }) } } },
    },
    responses: {
        201: { content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.any() }) } }, description: 'Created' },
        404: { description: 'Contact (or mentioned inspection) not found in this tenant' },
    },
    operationId: 'sendMessageThread',
    summary: 'Send into a contact thread, optionally mentioning an inspection',
    description: 'Posts an inspector-authored message to the contact thread. With inspectionId it is exactly the per-inspection send; without, it is pre-booking outreach — stored on the thread and nudged by a plain email, since no contact-facing surface shows no-inspection threads yet.',
}, { scopes: ['write'], tier: 'extended' }));

export const messageThreadRoutes = createApiRouter()
    .openapi(listThreadsRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const threads = await c.var.services.message.listThreads(tenantId);
        return c.json({ success: true as const, data: threads }, 200);
    })
    .openapi(getThreadRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const { contactId } = c.req.valid('param');
        const svc = c.var.services.message;
        const contact = await svc.contactById(tenantId, contactId);
        if (!contact) throw Errors.NotFound('Contact not found');
        const messages = await svc.listThreadForContact(tenantId, contactId);
        await svc.markContactThreadReadForStaff(tenantId, contactId);
        return c.json({ success: true as const, data: { contact: { contactId: contact.contactId, name: contact.name, email: contact.email }, messages } }, 200);
    })
    .openapi(sendThreadRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const { contactId } = c.req.valid('param');
        const { body, inspectionId } = c.req.valid('json');
        const jwtUser = c.get('user');
        const svc = c.var.services.message;
        const contact = await svc.contactById(tenantId, contactId);
        if (!contact) throw Errors.NotFound('Contact not found');
        // A mention must name one of THIS tenant's inspections the contact is
        // actually seated on — reject a foreign or unknown id rather than
        // storing a dangling reference.
        if (inspectionId) {
            const seat = await svc.contactOnInspection(tenantId, inspectionId, contactId);
            if (!seat) throw Errors.NotFound('Contact is not on that inspection');
        }
        const authorId = (jwtUser as { sub?: string } | undefined)?.sub ?? null;
        let authorName: string | null = null;
        if (authorId) {
            const { drizzle } = await import('drizzle-orm/d1');
            const { users } = await import('../lib/db/schema');
            const { and, eq } = await import('drizzle-orm');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const u = await drizzle(c.env.DB as any).select({ name: users.name }).from(users)
                .where(and(eq(users.id, authorId), eq(users.tenantId, tenantId))).get();
            authorName = u?.name ?? null;
        }
        const row = await svc.createMessage({
            tenantId,
            inspectionId: inspectionId ?? null,
            contactId,
            fromRole: 'inspector',
            fromUserId: authorId,
            fromName: authorName,
            body,
            attachments: [],
        });
        try {
            if (inspectionId) {
                await c.var.services.email.sendMessageNotification('client', inspectionId, row, {
                    db: c.env.DB, kv: c.env.TENANT_CACHE, baseUrl: c.env.APP_BASE_URL || `https://${c.req.header('host') ?? ''}`,
                    contactEmail: contact.email ?? undefined,
                });
            } else if (contact.email) {
                await c.var.services.email.sendContactMessageNotification(contact.email, row, { kv: c.env.TENANT_CACHE });
            }
        } catch { /* silent */ }
        return c.json({ success: true as const, data: row }, 201);
    });;

export type MessageThreadsApi = typeof messageThreadRoutes;
export default messageThreadRoutes;
