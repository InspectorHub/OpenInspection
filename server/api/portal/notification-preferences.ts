import { createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { createApiRouter } from '../../lib/openapi-router';
import { withMcpMetadata } from '../../lib/route-metadata-standards';
import { portalSessionGuard } from '../../lib/middleware/portal-session-guard';
import { getDrizzle } from '../../lib/route-helpers';
import type { HonoConfig } from '../../types/hono';
import { buildScreenModel } from '../../lib/notifications/screen-model';
import { assertChoosable, readChoices, writeChoice } from '../../lib/notifications/preference-write';
import { contactIdsForEmail } from '../../services/notice-inbox';
import { Errors } from '../../lib/errors';

/**
 * The client's own notification settings, in the portal (spec §4.1).
 *
 * A client has no account, so the subject cannot be a `users` row and the
 * identity cannot come from a JWT. It comes from the same place the Notices
 * inbox gets it: a verified email in the `__Host-portal_session` cookie plus the
 * tenant resolved from the path slug. The email is used for exactly one thing —
 * resolving which `contacts` rows are this person here.
 *
 * ONE EMAIL CAN BE SEVERAL CONTACTS in a tenant (a repeat client booked twice,
 * or the same person as client on one inspection and "other" on another). They
 * are one human with one inbox, so a choice is written to EVERY one of their
 * contact rows and a mute on ANY of them counts as off. Writing to just the
 * first would produce a switch that works on some of the mail and not the rest,
 * which is the kind of half-working control that is worse than none.
 */

const TenantParam = z.object({
    tenant: z.string().describe('Tenant slug (resolves the tenant from the URL path).'),
});

const ScreenResponseSchema = z.object({
    success: z.literal(true),
    data: z.object({
        alwaysSent: z.array(z.object({
            id: z.string(), label: z.string(), channels: z.array(z.string()),
        })),
        youChoose: z.array(z.object({
            id: z.string(),
            label: z.string(),
            channels: z.object({ email: z.string(), sms: z.string(), in_app: z.string() }),
        })),
    }),
}).openapi('PortalNotificationPreferencesScreen');

const SaveSchema = z.object({
    classId: z.string().describe('The notification class being changed, e.g. review-request.'),
    channel: z.enum(['email', 'sms', 'in_app']).describe('Which channel this choice applies to.'),
    enabled: z.boolean().describe('True to receive it again; false to switch it off.'),
});

function resolveTenantId(c: Context<HonoConfig>): string | null {
    return c.get('tenantId') || c.get('resolvedTenantId') || null;
}

const getScreenRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/{tenant}/notification-preferences',
    tags: ['public'],
    summary: 'What this company sends you, and what you can switch off',
    request: { params: TenantParam },
    responses: {
        200: {
            content: { 'application/json': { schema: ScreenResponseSchema } },
            description: 'The two sections spec §4 describes.',
        },
        401: { description: 'No valid portal session cookie' },
        404: { description: 'Tenant slug not found' },
    },
    operationId: 'portalGetNotificationPreferences',
    description:
        'Returns the notifications addressed to the signed-in recipient in this tenant, split ' +
        'into the ones that cannot be switched off and the ones they choose. Channels a class ' +
        'never uses are reported as "unavailable", which is not the same as "off".',
}, { scopes: [], tier: 'extended' }));

const saveRoute = createRoute(withMcpMetadata({
    method: 'put',
    path: '/{tenant}/notification-preferences',
    tags: ['public'],
    summary: 'Switch one notification on or off for one channel',
    request: {
        params: TenantParam,
        body: { content: { 'application/json': { schema: SaveSchema } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true) }) } },
            description: 'Saved.',
        },
        400: { description: 'Unknown class, or a class that cannot be switched off' },
        401: { description: 'No valid portal session cookie' },
    },
    operationId: 'portalSaveNotificationPreference',
    description:
        'Records one explicit choice against every contact row this session resolves to in this ' +
        'tenant. A choice that matches the class default deletes the row rather than storing it.',
}, { scopes: [], tier: 'extended' }));

const router = createApiRouter();
router.use('/:tenant/notification-preferences', portalSessionGuard);

const portalNotificationPreferenceRoutes = router
    .openapi(getScreenRoute, async (c) => {
        const tenantId = resolveTenantId(c);
        if (!tenantId) throw Errors.NotFound('Company not found.');
        const db = getDrizzle(c);
        const contactIds = await contactIdsForEmail(db, tenantId, c.get('portalEmail') as string);

        // A mute on ANY of this person's contact rows counts. Merged with "off
        // wins" rather than last-one-wins: the reader switched it off once and
        // must not have to find the other row to make it stick.
        const chosen = new Map<string, boolean>();
        for (const id of contactIds) {
            for (const [key, enabled] of await readChoices(db, tenantId, 'contact', id)) {
                if (!chosen.has(key) || enabled === false) chosen.set(key, enabled);
            }
        }
        return c.json({ success: true as const, data: buildScreenModel('client', chosen) }, 200);
    })
    .openapi(saveRoute, async (c) => {
        const tenantId = resolveTenantId(c);
        if (!tenantId) throw Errors.NotFound('Company not found.');
        const { classId, channel, enabled } = c.req.valid('json');

        // Refused at the edge as well as at the send boundary — the boundary is
        // what makes a preference true, this is what keeps the screen honest.
        assertChoosable(classId, channel, 'client');

        const db = getDrizzle(c);
        const contactIds = await contactIdsForEmail(db, tenantId, c.get('portalEmail') as string);
        if (contactIds.length === 0) {
            // A verified session with no contact row in this tenant. There is
            // nowhere to put the choice and nothing that would read it.
            throw Errors.BadRequest('There is nothing to change here.');
        }
        for (const subjectId of contactIds) {
            await writeChoice(db, {
                tenantId, subjectKind: 'contact', subjectId, classId, channel, enabled,
            });
        }
        return c.json({ success: true as const }, 200);
    });

export default portalNotificationPreferenceRoutes;
export type PortalNotificationPreferencesApi = typeof portalNotificationPreferenceRoutes;
