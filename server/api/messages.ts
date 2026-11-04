/**
 * Customer messaging — converged onto the unified resource URL shape (the same
 * pattern client-documents.ts established):
 *
 *   Inspector (JWT, mounted at /api/inspections):
 *     GET    /api/inspections/:id/messages                       — list + mark client msgs read
 *     POST   /api/inspections/:id/messages                       — send as inspector
 *     POST   /api/inspections/:id/messages/upload                — attach a file (multipart)
 *     GET    /api/inspections/:id/messages/attachments/:attId    — download an attachment
 *
 *   Client (portal session OR per-inspection token, mounted at /api/public):
 *     GET    /api/public/inspections/:id/messages                — list + mark inspector msgs read
 *     POST   /api/public/inspections/:id/messages                — send as client
 *     POST   /api/public/inspections/:id/messages/upload         — attach a file (multipart)
 *     GET    /api/public/inspections/:id/messages/attachments/:attId — download an attachment
 *
 *   Cross-cutting summary (JWT, mounted at /api/messages):
 *     GET    /api/messages/unread-count                          — sidebar badge (per tenant)
 *
 * A URL names the RESOURCE (an inspection's messages); auth is a credential
 * (JWT cookie for inspector; portal session cookie / ?token for client), NOT
 * part of the path. The client side authenticates via resolveClientActor
 * (shared with client-documents) — the messageToken keying is retired.
 */
import { mayActOnInspection, assertMayActOnInspection } from '../lib/inspection/assignment-access';
import type { Context, Next } from 'hono';
import { createRoute } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { mounted, type ApiOf } from '../lib/api-schema';
import { z } from '@hono/zod-openapi';
import { requireRole } from '../lib/middleware/rbac';
import { AppError, Errors } from '../lib/errors';
import { serveAttachment, storeAttachment, verifyAttachments } from '../lib/message-attachment';
import { withMcpMetadata } from '../lib/route-metadata-standards';
import { resolveClientActor } from '../lib/portal-client-actor';
import { buildPortalUrl } from '../lib/portal-urls';
import { getBaseUrl, resolveTenantSlug } from '../lib/url';
import type { HonoConfig } from '../types/hono';
import { messageThreadRoutes, messageThreadRouteConfigs } from './messages-threads';
import { clientMessageListRoute, clientMessageSendRoute } from './messages-client-routes';
import { resolveInspectionScope } from '../lib/inspection/visibility';
import { projectClientMessage } from '../lib/client-message-view';

const AttachmentSchema = z.object({
    id: z.string().max(64).describe('Stable attachment identifier within the message.'),
    key: z.string().max(300).describe('R2 object key the attachment bytes are stored under.'),
    name: z.string().max(255).describe('Original uploaded filename.'),
    size: z.number().describe('Attachment size in bytes.'),
    type: z.string().max(100).describe('Detected MIME type of the attachment.'),
    uploadedAt: z.number().describe('Epoch-ms timestamp the attachment was uploaded.'),
});

// ── Inspector routes (authed by global JWT; mounted at /api/inspections) ──────

// GET /api/inspections/{inspectionId}/messages — list inspector view
const listRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/{inspectionId}/messages',
    tags: ['messages'],
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: { params: z.object({ inspectionId: z.string().describe('Inspection whose conversation to list.') }).describe('Path parameters.') },
    responses: {
        200: { content: { 'application/json': { schema: z.object({
            success: z.boolean().describe('Whether the request succeeded.'),
            data: z.array(z.any()).describe('Messages for the inspection, oldest first.'),
        }) } }, description: 'OK' },
        401: { description: 'Unauthorized' },
    },
    operationId: 'getMessageInspection',
    summary: 'List messages for an inspection (inspector view)',
    description: 'Returns the message thread for an inspection (oldest first) and marks all client messages read, but only when the caller works the inspection (assigned, or granted scheduleOthers, or owner and manager); other inspectors can read the thread and leave the unread counts alone. Inspector-authenticated.',
}, { scopes: ['read'], tier: 'extended' }));

// POST /api/inspections/{inspectionId}/messages — send message as inspector
const sendRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/{inspectionId}/messages',
    tags: ['messages'],
    middleware: [requireRole('owner', 'manager', 'inspector'), guardMessageSend] as const,
    request: {
        params: z.object({ inspectionId: z.string().describe('Inspection to post the message to.') }).describe('Path parameters.'),
        body: { content: { 'application/json': { schema: z.object({
            body: z.string().min(1).max(5000).describe('Message body text.'),
            attachments: z.array(AttachmentSchema).max(5).optional().describe('Up to 5 previously-uploaded attachments.'),
            contactId: z.string().optional().describe('Which contact\'s thread to post into (compose picker). Omitted: the primary client\'s thread. 404 when the contact is not on this inspection.'),
        }).describe('Message payload.') } } },
    },
    responses: {
        201: { content: { 'application/json': { schema: z.object({ success: z.boolean().describe('Whether the request succeeded.'), data: z.any().describe('The created message row.') }).describe('Created message.') } }, description: 'Created' },
        401: { description: 'Unauthorized' },
        503: { description: 'Attachment storage could not be read' },
    },
    operationId: 'createMessageInspection',
    summary: 'Send a message to a client (inspector)',
    description: 'Creates an inspector-authored message on an inspection and notifies the client by email. Owner and manager, and inspectors assigned to the inspection or granted the scheduleOthers capability; other inspectors get 403.',
}, { scopes: ['write'], tier: 'extended' }));

// POST /api/inspections/{inspectionId}/messages/upload — attach a file (inspector)
const uploadRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/{inspectionId}/messages/upload',
    tags: ['messages'],
    middleware: [requireRole('owner', 'manager', 'inspector'), guardMessageSend] as const,
    request: { params: z.object({ inspectionId: z.string().describe('Inspection the attachment belongs to.') }).describe('Path parameters.') },
    responses: {
        200: { content: { 'application/json': { schema: z.object({
            success: z.boolean().describe('Whether the request succeeded.'),
            data: AttachmentSchema.describe('The stored attachment descriptor.'),
        }) } }, description: 'OK' },
        503: { description: 'Attachment storage could not be written' },
    },
    operationId: 'uploadMessageInspection',
    summary: 'Upload a message attachment (inspector)',
    description: 'Streams a multipart file into R2 and returns the attachment descriptor to attach to a subsequent message. Owner and manager, and inspectors assigned to the inspection or granted the scheduleOthers capability; other inspectors get 403.',
}, { scopes: ['write'], tier: 'extended' }));

// GET /api/inspections/{inspectionId}/messages/attachments/{attachmentId}
const attachmentRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/{inspectionId}/messages/attachments/{attachmentId}',
    tags: ['messages'],
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: { params: z.object({
        inspectionId: z.string().describe('Inspection the attachment belongs to.'),
        attachmentId: z.string().describe('Attachment id within the conversation.'),
    }) },
    responses: {
        200: { content: { 'application/octet-stream': { schema: z.any() } }, description: 'Attachment bytes' },
        404: { description: 'Not found' },
        503: { description: 'Attachment storage could not be read' },
    },
    operationId: 'downloadMessageAttachmentInspection',
    summary: 'Download a message attachment (inspector)',
    description: 'Streams a message attachment from R2, scoped by inspection id + attachment id. Inspector-authenticated.',
}, { scopes: ['read'], tier: 'extended' }));

// GET /api/messages/unread-count — sidebar badge (cross-inspection summary)
const unreadRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/unread-count',
    tags: ['messages'],
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    responses: {
        200: { content: { 'application/json': { schema: z.object({
            success: z.boolean().describe('Whether the request succeeded.'),
            data: z.object({ count: z.number().describe('Number of unread client messages across the tenant.') }).describe('Unread summary.'),
        }) } }, description: 'OK' },
        401: { description: 'Unauthorized' },
    },
    operationId: 'unreadCountMessage',
    summary: 'Unread client-message count for the tenant',
    description: 'Returns the count of unread client messages across all inspections in the tenant (sidebar badge). The lone cross-cutting messages summary — every other messages route is per-inspection. A caller whose access is limited to the inspections assigned to them receives only what is tied to those inspections.',
}, { scopes: ['read'], tier: 'extended' }));

// ── helpers (shared upload logic) ────────────────────────────────────────────

/** Sending into an inspection's thread is the assignee's act (or `scheduleOthers`). */
async function guardMessageSend(c: Context<HonoConfig>, next: Next) {
    await assertMayActOnInspection(c, c.req.param('inspectionId') ?? '', 'message its client');
    return next();
}

// ── Inspector router (typed client + MCP) ────────────────────────────────────

export const inspectorMessageRoutes = createApiRouter();
inspectorMessageRoutes.openapi(listRoute, async (c) => {
    const { inspectionId } = c.req.valid('param');
    const tenantId = c.get('tenantId');
    const svc = c.var.services.message;
    const messages = await svc.listForInspection(inspectionId, tenantId);
    // The inspector opened the merged view: mark every counterparty-authored
    // message on the inspection read (all threads — this is the one surface
    // that shows them all).
    // Reading stays company-wide; clearing the counts is the assignee's act.
    if (await mayActOnInspection(c, inspectionId)) await svc.markInspectionReadForStaff(inspectionId, tenantId);
    return c.json({ success: true, data: messages }, 200); // projection-allow: inspector route behind the session middleware: the staff view of the conversation
});
inspectorMessageRoutes.openapi(sendRoute, async (c) => {
    const { inspectionId } = c.req.valid('param');
    const tenantId = c.get('tenantId');
    const { body, attachments, contactId } = c.req.valid('json');
    const stored = await verifyAttachments(c.env.PHOTOS, attachments ?? [], tenantId, inspectionId);
    if (!stored) throw Errors.BadRequest('Check the attachments and try again.');
    const jwtUser = c.get('user');
    const svc = c.var.services.message;
    // Which thread this reply belongs to: the named contact's (compose
    // picker), else the primary client's. A contactId not seated on this
    // inspection is a 404, not a silent fallback — falling back would post
    // the reply into a stranger's thread.
    const thread = contactId
        ? await svc.contactOnInspection(tenantId, inspectionId, contactId)
        : await svc.primaryClientThread(tenantId, inspectionId);
    if (contactId && !thread) throw Errors.NotFound('Contact is not on this inspection');
    if (!thread) throw Errors.BadRequest('Inspection has no client to message');
    // The JWT carries `sub`, not `id`, and no display name (looked up from
    // the DB when needed) — resolve the author's name so the client's
    // portal shows who replied instead of a bare role label.
    const authorId = (jwtUser as { sub?: string } | undefined)?.sub ?? null;
    let authorName: string | null = (jwtUser as { name?: string } | undefined)?.name ?? null;
    if (!authorName && authorId) {
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
        inspectionId,
        contactId: thread.contactId,
        fromRole: 'inspector',
        fromUserId: authorId,
        fromName: authorName,
        body,
        attachments: stored,
    });
    // T22: notify the THREAD's contact — not unconditionally the primary
    // client. Build a unified-portal Messages deep-link the same way the
    // report-ready email does (per-recipient portal token + slug), so the
    // no-login recipient lands in the Hub messages tab already authorized.
    try {
        let clientViewUrl: string | undefined;
        try {
            if (thread.email) {
                const slug = await resolveTenantSlug(c, tenantId);
                const portalToken = await c.var.services.portalAccess.issueToken({
                    tenantId, inspectionId, recipientEmail: thread.email, role: 'client',
                });
                clientViewUrl = buildPortalUrl(getBaseUrl(c), slug, inspectionId, portalToken, 'messages');
            }
        } catch { /* fall back to the Hub overview inside the email service */ }
        await c.var.services.email.sendMessageNotification('client', inspectionId, row, {
            db: c.env.DB, kv: c.env.TENANT_CACHE, baseUrl: c.env.APP_BASE_URL || `https://${c.req.header('host') ?? ''}`,
            clientViewUrl,
            contactEmail: thread.email ?? undefined,
        });
    } catch { /* silent */ }
    return c.json({ success: true, data: row }, 201); // projection-allow: inspector route behind the session middleware: the staff view of the created message
});
inspectorMessageRoutes.openapi(uploadRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const fd = await c.req.parseBody();
    const data = await storeAttachment(c.env.PHOTOS, fd['file'] as File | undefined, tenantId, c.req.valid('param').inspectionId);
    return c.json({ success: true, data }, 200); // projection-allow: inspector route behind the session middleware: the descriptor of the file just uploaded
});
inspectorMessageRoutes.openapi(attachmentRoute, async (c) => {
    const { inspectionId, attachmentId } = c.req.valid('param');
    const tenantId = c.get('tenantId');
    const att = await c.var.services.message.resolveAttachmentForInspection(inspectionId, tenantId, attachmentId);
    const download = att ? await serveAttachment(c.env.PHOTOS, att, tenantId) : null;
    if (!download) throw Errors.NotFound('Attachment not found');
    return download;
});

export const inspectorMessageRouteConfigs = [listRoute, sendRoute, uploadRoute, attachmentRoute] as const;

// Company inbox thread routes live in ./messages-threads (Track D); they
// compose onto this same /api/messages mount below.

const messageRoutes = createApiRouter();
messageRoutes.openapi(unreadRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const count = await c.var.services.message.unreadCountForTenant(tenantId, await resolveInspectionScope(c));
    return c.json({ success: true, data: { count } }, 200); // projection-allow: inspector route behind the session middleware: an unread count
});
messageRoutes.route('/', messageThreadRoutes);

export const messageRouteParts = [unreadRoute, mounted('/', messageThreadRoutes, messageThreadRouteConfigs)] as const;

export type MessagesApi = ApiOf<typeof messageRouteParts>;
export type InspectorMessagesApi = ApiOf<typeof inspectorMessageRouteConfigs>;

// ── Client router (resolveClientActor-gated; mounted at /api/public) ──────────

const sendBodySchema = z.object({
    body: z.string().min(1).max(5000),
    attachments: z.array(z.object({
        id: z.string().max(64), key: z.string().max(300), name: z.string().max(255), size: z.number(), type: z.string().max(100), uploadedAt: z.number(),
    })).max(5).optional(),
});

export const clientMessageRoutes = createApiRouter();

clientMessageRoutes.openapi(clientMessageListRoute, async (c) => {
    const { id: inspectionId } = c.req.valid('param');
    const actor = await resolveClientActor(c, inspectionId);
    if (!actor) return c.json({ error: 'Unauthorized' }, 401);
    const svc = c.var.services.message;
    // The portal viewer sees THEIR thread, and marking read is scoped to it —
    // an inspection-wide mark would clear unread state on every participant's
    // thread the moment one of them looked (per-contact threading, design §3.9).
    const thread = await svc.resolveThreadContact(actor.tenantId, inspectionId, actor.ref);
    const all = await svc.listForInspection(inspectionId, actor.tenantId);
    const messages = thread ? all.filter((mrow) => mrow.contactId === thread.contactId) : []; // a caller with no seat has no thread, so the list is empty
    if (thread) await svc.markThreadReadForContact(actor.tenantId, thread.contactId, inspectionId);
    return c.json({ success: true as const, data: messages.map((message) => projectClientMessage(message)) }, 200);
});

clientMessageRoutes.openapi(clientMessageSendRoute, async (c) => {
    const { id: inspectionId } = c.req.valid('param');
    const actor = await resolveClientActor(c, inspectionId);
    if (!actor) return c.json({ error: 'Unauthorized' }, 401);
    const parsed = sendBodySchema.safeParse(await c.req.json().catch(() => null));
    let stored: Awaited<ReturnType<typeof verifyAttachments>>;
    try {
        stored = parsed.success ? await verifyAttachments(c.env.PHOTOS, parsed.data.attachments ?? [], actor.tenantId, inspectionId) : null;
    } catch (err) {
        if (err instanceof AppError && err.status === 503) return c.json({ error: 'Attachment storage is unavailable.' }, 503);
        throw err;
    }
    if (!parsed.success || !stored) return c.json({ error: 'Invalid message payload.' }, 400);
    const svc = c.var.services.message;
    // Attribution goes through the actor's OWN seat (matched by their verified
    // email), not unconditionally through the primary client — the old path is
    // why a co-client's messages were signed with the primary client's name.
    const thread = await svc.resolveThreadContact(actor.tenantId, inspectionId, actor.ref);
    if (!thread) return c.json({ error: 'No client seat on this inspection.' }, 403);
    const row = await svc.createMessage({
        tenantId: actor.tenantId,
        inspectionId,
        contactId: thread.contactId,
        fromRole: 'client',
        fromName: thread.name ?? actor.ref,
        body: parsed.data.body,
        attachments: stored,
    });
    // T22: notify inspector
    try {
        await c.var.services.email.sendMessageNotification('inspector', inspectionId, row, {
            db: c.env.DB, kv: c.env.TENANT_CACHE, baseUrl: c.env.APP_BASE_URL || `https://${c.req.header('host') ?? ''}`,
        });
    } catch { /* silent */ }
    return c.json({ success: true as const, data: projectClientMessage(row) }, 201);
});

// POST /api/public/inspections/:id/messages/upload — attach a file (client).
clientMessageRoutes.post('/inspections/:id/messages/upload', async (c) => {
    const inspectionId = c.req.param('id');
    const actor = await resolveClientActor(c, inspectionId);
    if (!actor) return c.json({ error: 'Unauthorized' }, 401);
    const fd = await c.req.parseBody();
    try {
        const data = await storeAttachment(c.env.PHOTOS, fd['file'] as File | undefined, actor.tenantId, inspectionId);
        return c.json({ success: true, data }, 200); // projection-allow: the descriptor of the file just uploaded; the sender posts it back with its key, which the send route validates
    } catch (err) {
        if (err instanceof AppError && err.status === 503) return c.json({ error: 'Attachment storage is unavailable.' }, 503);
        return c.json({ error: 'Upload rejected.' }, 400);
    }
});

// GET /api/public/inspections/:id/messages/attachments/:attId — download.
clientMessageRoutes.get('/inspections/:id/messages/attachments/:attachmentId', async (c) => {
    const inspectionId = c.req.param('id');
    const attachmentId = c.req.param('attachmentId');
    const actor = await resolveClientActor(c, inspectionId);
    if (!actor) return c.json({ error: 'Unauthorized' }, 401);
    // A client downloads the attachments of its own thread.
    const thread = await c.var.services.message.resolveThreadContact(actor.tenantId, inspectionId, actor.ref);
    const att = thread ? await c.var.services.message.resolveAttachmentForInspection(inspectionId, actor.tenantId, attachmentId, thread.contactId) : null;
    try {
        return (att ? await serveAttachment(c.env.PHOTOS, att, actor.tenantId) : null) ?? c.json({ error: 'Not found' }, 404);
    } catch (err) {
        if (err instanceof AppError && err.status === 503) return c.json({ error: 'Attachment storage is unavailable.' }, 503);
        throw err;
    }
});

export const clientMessageRouteConfigs = [clientMessageListRoute, clientMessageSendRoute] as const;
export type ClientMessagesApi = ApiOf<typeof clientMessageRouteConfigs>;

export default messageRoutes;
