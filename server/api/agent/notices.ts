/**
 * Track C3 — the AGENT portal's Notices inbox (design §3.11/§3.15).
 *
 * Same reader as the client's (server/services/notice-inbox.ts), different
 * answer to "who am I": an agent account is global, and IA-104 put the binding
 * on the contact row, so the inbox spans every company that has this agent as
 * a contact. One indexed read, no per-tenant loop, no tenantId on the route —
 * an agent JWT carries none.
 */
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { withMcpMetadata } from '../../lib/route-metadata-standards';
import { requireRole } from '../../lib/middleware/rbac';
import { getDrizzle } from '../../lib/route-helpers';
import { Errors } from '../../lib/errors';
import {
    NoticeListResponseSchema,
    NoticeMarkReadSchema,
    NoticeOkResponseSchema,
} from '../../lib/validations/notice-inbox.schema';
import {
    listNoticesForContacts,
    unreadNoticeCountForContacts,
    markNoticesRead,
    markAllNoticesRead,
    archiveNotice,
    contactIdsForAgent,
    getOwnedNotice,
} from '../../services/notice-inbox';
import { mintOptinToken } from '../../lib/sms/optin-token';

const listRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/notices',
    tags: ['agents'],
    summary: "List the notices addressed to the signed-in agent",
    responses: {
        200: { content: { 'application/json': { schema: NoticeListResponseSchema } }, description: "The agent's own notices across every company, newest first." },
        401: { description: 'Unauthorized' },
        403: { description: 'Forbidden' },
    },
    security: [{ bearerAuth: [] }],
    operationId: 'listAgentNotices',
    description:
        'Returns the notices addressed to this agent across every company that has them as a ' +
        'contact, each with its own per-channel delivery attempts. Addressed by contact id ' +
        '(contacts.agent_user_id), never by matching an email or the delivery ledger recipient ' +
        'string. Another recipient\'s rows are unreachable by construction — the notice header ' +
        'is per-recipient.',
}, { scopes: ['agent'], tier: 'extended' }));

const markReadRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/notices/mark-read',
    tags: ['agents'],
    summary: 'Mark agent notices read',
    request: { body: { content: { 'application/json': { schema: NoticeMarkReadSchema } } } },
    responses: {
        200: { content: { 'application/json': { schema: NoticeOkResponseSchema } }, description: 'Marked read (idempotent).' },
        401: { description: 'Unauthorized' },
        403: { description: 'Forbidden' },
    },
    security: [{ bearerAuth: [] }],
    operationId: 'markAgentNoticesRead',
    description: 'Marks the given notice ids read, or every unread notice when ids is omitted. The ownership predicate is part of the UPDATE.',
}, { scopes: ['agent'], tier: 'extended' }));

const archiveRoute = createRoute(withMcpMetadata({
    method: 'delete',
    path: '/notices/{id}',
    tags: ['agents'],
    summary: 'Dismiss (archive) an agent notice',
    request: { params: z.object({ id: z.string().min(1).describe('Notice header id to dismiss.') }) },
    responses: {
        200: { content: { 'application/json': { schema: NoticeOkResponseSchema } }, description: 'Archived (idempotent).' },
        401: { description: 'Unauthorized' },
        403: { description: 'Forbidden' },
    },
    security: [{ bearerAuth: [] }],
    operationId: 'archiveAgentNotice',
    description: 'Archives the notice for this agent. Never a row deletion, and never a write to automation_logs — the sending company keeps its delivery record.',
}, { scopes: ['agent'], tier: 'extended' }));

const optinLinkRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/notices/{id}/optin-link',
    tags: ['agents'],
    summary: 'Mint the SMS opt-in link for a notice the agent owns',
    request: { params: z.object({ id: z.string().min(1).describe('Notice header id whose contact should be opted in.') }) },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({
                success: z.literal(true).describe('Always true on a 200.'),
                data: z.object({ url: z.string().describe('Relative URL of the double-opt-in page.') }).describe('Where to send the agent.'),
            }) } },
            description: "The opt-in page URL for this notice's contact.",
        },
        401: { description: 'Unauthorized' },
        403: { description: 'Forbidden' },
        404: { description: 'The notice is not this agent\'s' },
    },
    security: [{ bearerAuth: [] }],
    operationId: 'agentNoticeOptinLink',
    description:
        "Mints the sealed double-opt-in token for the contact row the notice is addressed to — " +
        'the agent\'s own contact in the sending company. Keyed to a notice the caller already ' +
        'owns, so it cannot be aimed at anyone else.',
}, { scopes: ['agent'], tier: 'extended' }));

/** Mounted under the /api/agent router group (see server/api/agent.ts). */
export const agentNoticeRoutes = createApiRouter()
    .openapi(listRoute, async (c) => {
        await requireRole('agent')(c, async () => {});
        const user = c.get('user');
        if (!user?.sub) throw Errors.Unauthorized();
        const db = getDrizzle(c);
        const contactIds = await contactIdsForAgent(db, user.sub);
        const [notices, unread] = await Promise.all([
            listNoticesForContacts(db, { contactIds }),
            unreadNoticeCountForContacts(db, contactIds),
        ]);
        return c.json({ success: true as const, data: { notices, unread } }, 200);
    })
    .openapi(markReadRoute, async (c) => {
        await requireRole('agent')(c, async () => {});
        const user = c.get('user');
        if (!user?.sub) throw Errors.Unauthorized();
        const db = getDrizzle(c);
        const contactIds = await contactIdsForAgent(db, user.sub);
        const { ids } = c.req.valid('json');
        if (ids && ids.length > 0) await markNoticesRead(db, contactIds, ids);
        else await markAllNoticesRead(db, contactIds);
        return c.json({ success: true as const, data: { ok: true as const } }, 200);
    })
    .openapi(archiveRoute, async (c) => {
        await requireRole('agent')(c, async () => {});
        const user = c.get('user');
        if (!user?.sub) throw Errors.Unauthorized();
        const db = getDrizzle(c);
        const contactIds = await contactIdsForAgent(db, user.sub);
        const { id } = c.req.valid('param');
        await archiveNotice(db, contactIds, id);
        return c.json({ success: true as const, data: { ok: true as const } }, 200);
    })
    .openapi(optinLinkRoute, async (c) => {
        await requireRole('agent')(c, async () => {});
        const user = c.get('user');
        if (!user?.sub) throw Errors.Unauthorized();
        const db = getDrizzle(c);
        const contactIds = await contactIdsForAgent(db, user.sub);
        const { id } = c.req.valid('param');
        const owned = await getOwnedNotice(db, contactIds, id);
        if (!owned) return c.json({ error: 'Not found' }, 404);
        const token = await mintOptinToken(owned.tenantId, owned.contactId, c.env.JWT_SECRET);
        return c.json({ success: true as const, data: { url: `/sms-optin/${encodeURIComponent(token)}` } }, 200);
    });

export type AgentNoticesApi = typeof agentNoticeRoutes;

export default agentNoticeRoutes;
