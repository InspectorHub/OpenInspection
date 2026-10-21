/**
 * Company inbox routes (Track D, design §3.9) — mounted at /api/messages
 * beside the unread-count summary. Threads are contact-keyed, so the
 * company-wide Conversations view is `WHERE contact_id` over the same table
 * the per-inspection view reads. Split from messages.ts purely for file size;
 * the router composes back into the same mount and the same typed client.
 */
import { mayActOnContact, mayActOnInspection } from '../lib/inspection/assignment-access';
import { createRoute } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { z } from '@hono/zod-openapi';
import { requireRole } from '../lib/middleware/rbac';
import { Errors } from '../lib/errors';
import { deniedNeedsPermission } from '../lib/permission-denied';
import { withMcpMetadata } from '../lib/route-metadata-standards';
import { requireVisibleInspection, requireVisibleContact, resolveInspectionScope } from '../lib/inspection/visibility';
import { getDrizzle } from '../lib/route-helpers';

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
    description: 'Per-contact thread summaries across every inspection and the no-inspection outreach rows, newest activity first. A caller whose access is limited to the inspections assigned to them receives only what is tied to those inspections.',
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
    description: "Every message with this contact — across inspections and the rows with no inspection attached — oldest first. Reading it marks the thread's counterparty messages read. For a caller whose access is limited to the inspections assigned to them, an item tied to an inspection outside that set is answered as not found.",
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
    description: 'Owner and manager, and inspectors who work an inspection the contact is on or hold scheduleOthers (a contact on no inspection yet is open to all staff); other inspectors get 403. Posts an inspector-authored message to the contact thread. With inspectionId it is exactly the per-inspection send; without, it is pre-booking outreach — stored on the thread and nudged by a plain email, since no contact-facing surface shows no-inspection threads yet. For a caller whose access is limited to the inspections assigned to them, an item tied to an inspection outside that set is answered as not found.',
}, { scopes: ['write'], tier: 'extended' }));

export const messageThreadRoutes = createApiRouter();
messageThreadRoutes.openapi(listThreadsRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const threads = await c.var.services.message.listThreads(tenantId, await resolveInspectionScope(c));
    return c.json({ success: true as const, data: threads }, 200);
});
messageThreadRoutes.openapi(getThreadRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const { contactId } = c.req.valid('param');
    const svc = c.var.services.message;
    const scope = await resolveInspectionScope(c);
    // A contact outside the caller's scope answers exactly like one that does not exist.
    await requireVisibleContact(getDrizzle(c), scope, tenantId, contactId);
    const contact = await svc.contactById(tenantId, contactId);
    if (!contact) throw Errors.NotFound('Contact not found');
    const messages = await svc.listThreadForContact(tenantId, contactId, scope);
    // Clearing the counts belongs to whoever works the contact, and only ever clears what the caller could read.
    if (await mayActOnContact(c, contactId)) await svc.markContactThreadReadForStaff(tenantId, contactId, scope);
    return c.json({ success: true as const, data: { contact: { contactId: contact.contactId, name: contact.name, email: contact.email }, messages } }, 200);
});
messageThreadRoutes.openapi(sendThreadRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const { contactId } = c.req.valid('param');
    const { body, inspectionId } = c.req.valid('json');
    const jwtUser = c.get('user');
    const svc = c.var.services.message;
    const scope = await resolveInspectionScope(c);
    await requireVisibleContact(getDrizzle(c), scope, tenantId, contactId);
    // A mentioned inspection the caller cannot see is not found, however the rest of the request reads.
    if (inspectionId) await requireVisibleInspection(getDrizzle(c), scope, tenantId, inspectionId);
    const contact = await svc.contactById(tenantId, contactId);
    if (!contact) throw Errors.NotFound('Contact not found');
    // Messaging a client is the assignee's act: the thread's contact must be on one of the
    // caller's inspections, or the caller holds scheduleOthers (or the contact has none yet).
    if (inspectionId ? !(await mayActOnInspection(c, inspectionId)) : !(await mayActOnContact(c, contactId))) {
        throw deniedNeedsPermission(c, 'scheduleOthers', 'You are not assigned to this contact, so you cannot message them');
    }
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
});

/** Registration order. Drives the typed client; a test pins it to what `messageThreadRoutes` really registered. */
export const messageThreadRouteConfigs = [
    listThreadsRoute,
    getThreadRoute,
    sendThreadRoute,
] as const;

// No default export and no standalone Api type: the router composes onto
// /api/messages inside messages.ts, so its types flow through MessagesApi.
