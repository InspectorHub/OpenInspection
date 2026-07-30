/**
 * Track C3 — the CLIENT portal's Notices inbox (design §3.11/§3.15/§3.16).
 *
 * Mounted alongside server/api/portal.ts under `/api/portal`, in its own module
 * so neither file carries the other's weight. Same auth as the Hub reads: the
 * `__Host-portal_session` cookie (a verified email) plus the tenant resolved
 * from the path slug.
 *
 * The read is `notifications WHERE contact_id IN (my contact rows in this
 * tenant)` — never a match on the delivery ledger's `recipient` string, which
 * holds a phone number for every SMS attempt and would silently drop them.
 * Resolution of "my contact rows" is the ONLY place the email is used.
 *
 * Dismissing a notice archives the header and stops there; `automation_logs`
 * is untouched, so the inspector's Outbox keeps the delivery forever (§3.15).
 */
import { createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { createApiRouter } from '../../lib/openapi-router';
import { withMcpMetadata } from '../../lib/route-metadata-standards';
import { portalSessionGuard } from '../../lib/middleware/portal-session-guard';
import { getDrizzle } from '../../lib/route-helpers';
import type { HonoConfig } from '../../types/hono';
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
    contactIdsForEmail,
    getOwnedNotice,
} from '../../services/notice-inbox';
import { mintOptinToken } from '../../lib/sms/optin-token';

const TenantParam = z.object({
    tenant: z.string().describe('Tenant slug (resolves the tenant from the URL path).'),
});

function resolveTenantId(c: Context<HonoConfig>): string | null {
    return c.get('tenantId') || c.get('resolvedTenantId') || null;
}

const listRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/{tenant}/notices',
    tags: ['public'],
    summary: 'List the notices addressed to the signed-in recipient',
    request: { params: TenantParam },
    responses: {
        200: {
            content: { 'application/json': { schema: NoticeListResponseSchema } },
            description: "The recipient's own notices, newest first, plus the unread count.",
        },
        401: { description: 'No valid portal session cookie' },
        404: { description: 'Tenant slug not found' },
    },
    operationId: 'portalListNotices',
    description:
        'Returns the notices addressed to the session email in this tenant, each with its own ' +
        'per-channel delivery attempts. Addressed by contact id (resolved from the verified ' +
        'session email), never by matching the delivery ledger recipient string — an SMS ' +
        "attempt's recipient is a phone number. A recipient can only ever reach their own rows: " +
        'the notice header is per-recipient by construction.',
}, { scopes: [], tier: 'extended' }));

const markReadRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/{tenant}/notices/mark-read',
    tags: ['public'],
    summary: 'Mark the caller notices as read',
    request: {
        params: TenantParam,
        body: { content: { 'application/json': { schema: NoticeMarkReadSchema } } },
    },
    responses: {
        200: { content: { 'application/json': { schema: NoticeOkResponseSchema } }, description: 'Marked read (idempotent).' },
        401: { description: 'No valid portal session cookie' },
        404: { description: 'Tenant slug not found' },
    },
    operationId: 'portalMarkNoticesRead',
    description:
        'Marks the given notice ids read, or every unread notice when ids is omitted. The ' +
        "ownership predicate is part of the UPDATE, so another recipient's id matches no row.",
}, { scopes: [], tier: 'extended' }));

const archiveRoute = createRoute(withMcpMetadata({
    method: 'delete',
    path: '/{tenant}/notices/{id}',
    tags: ['public'],
    summary: 'Dismiss (archive) a notice',
    request: {
        params: TenantParam.extend({ id: z.string().min(1).describe('Notice header id to dismiss.') }),
    },
    responses: {
        200: { content: { 'application/json': { schema: NoticeOkResponseSchema } }, description: 'Archived (idempotent).' },
        401: { description: 'No valid portal session cookie' },
        404: { description: 'Tenant slug not found' },
    },
    operationId: 'portalArchiveNotice',
    description:
        'Archives the notice for this recipient. Never a row deletion, and never a write to ' +
        'automation_logs: a recipient tidying their own inbox cannot edit the sending ' +
        "company's delivery record, which the inspector's Outbox keeps forever.",
}, { scopes: [], tier: 'extended' }));

const optinLinkRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/{tenant}/notices/{id}/optin-link',
    tags: ['public'],
    summary: 'Mint the SMS opt-in link for a notice the caller owns',
    request: {
        params: TenantParam.extend({ id: z.string().min(1).describe('Notice header id whose contact should be opted in.') }),
    },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({
                success: z.literal(true).describe('Always true on a 200.'),
                data: z.object({ url: z.string().describe('Relative URL of the double-opt-in page.') }).describe('Where to send the recipient.'),
            }) } },
            description: 'The opt-in page URL for this notice\'s contact.',
        },
        401: { description: 'No valid portal session cookie' },
        404: { description: 'Tenant slug not found, or the notice is not the caller\'s' },
    },
    operationId: 'portalNoticeOptinLink',
    description:
        "Mints the sealed double-opt-in token for the CONTACT the notice is addressed to, so " +
        'the "Turn on texts" remedy leads somewhere real. Keyed to a notice the caller already ' +
        'owns rather than to a caller-supplied contact id, so it cannot be aimed at anyone else. ' +
        'Consent itself is still granted on the opt-in page — this only builds the link.',
}, { scopes: [], tier: 'extended' }));

const router = createApiRouter();
router.use('/:tenant/notices', portalSessionGuard);
router.use('/:tenant/notices/*', portalSessionGuard);

const portalNoticeRoutes = router
    .openapi(listRoute, async (c) => {
        const tenantId = resolveTenantId(c);
        if (!tenantId) return c.json({ error: 'Tenant not found' }, 404);
        const db = getDrizzle(c);
        const contactIds = await contactIdsForEmail(db, tenantId, c.get('portalEmail') as string);
        const [notices, unread] = await Promise.all([
            listNoticesForContacts(db, { contactIds }),
            unreadNoticeCountForContacts(db, contactIds),
        ]);
        return c.json({ success: true as const, data: { notices, unread } }, 200);
    })
    .openapi(markReadRoute, async (c) => {
        const tenantId = resolveTenantId(c);
        if (!tenantId) return c.json({ error: 'Tenant not found' }, 404);
        const db = getDrizzle(c);
        const contactIds = await contactIdsForEmail(db, tenantId, c.get('portalEmail') as string);
        const { ids } = c.req.valid('json');
        if (ids && ids.length > 0) await markNoticesRead(db, contactIds, ids);
        else await markAllNoticesRead(db, contactIds);
        return c.json({ success: true as const, data: { ok: true as const } }, 200);
    })
    .openapi(archiveRoute, async (c) => {
        const tenantId = resolveTenantId(c);
        if (!tenantId) return c.json({ error: 'Tenant not found' }, 404);
        const db = getDrizzle(c);
        const contactIds = await contactIdsForEmail(db, tenantId, c.get('portalEmail') as string);
        const { id } = c.req.valid('param');
        await archiveNotice(db, contactIds, id);
        return c.json({ success: true as const, data: { ok: true as const } }, 200);
    })
    .openapi(optinLinkRoute, async (c) => {
        const tenantId = resolveTenantId(c);
        if (!tenantId) return c.json({ error: 'Tenant not found' }, 404);
        const db = getDrizzle(c);
        const contactIds = await contactIdsForEmail(db, tenantId, c.get('portalEmail') as string);
        const { id } = c.req.valid('param');
        const owned = await getOwnedNotice(db, contactIds, id);
        if (!owned) return c.json({ error: 'Not found' }, 404);
        const token = await mintOptinToken(owned.tenantId, owned.contactId, c.env.JWT_SECRET);
        return c.json({ success: true as const, data: { url: `/sms-optin/${encodeURIComponent(token)}` } }, 200);
    });

export type PortalNoticesApi = typeof portalNoticeRoutes;

export default portalNoticeRoutes;
