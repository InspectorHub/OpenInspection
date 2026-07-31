import { createRoute, z } from '@hono/zod-openapi';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createApiRouter } from '../lib/openapi-router';
import { withMcpMetadata } from '../lib/route-metadata-standards';
import { getDrizzle } from '../lib/route-helpers';
import { notificationPreferences } from '../lib/db/schema';
import { buildScreenModel } from '../lib/notifications/screen-model';
import { isSuppressible, notificationClass } from '../lib/notifications/classes';
import { Errors } from '../lib/errors';

/**
 * The signed-in reader's own notification preferences (spec §4).
 *
 * SUBJECT COMES FROM THE SESSION, NEVER THE BODY. A preference is a statement
 * about one person, so accepting a subject id from the caller would let anyone
 * mute anyone. The route reads it from the JWT and the body carries only what
 * is being changed.
 *
 * This is the STAFF/AGENT surface — an account holder, so the subject is a
 * `users` row. The client portal has no account and authenticates by token;
 * that surface resolves a `contacts` subject and is its own route.
 */

const ChannelSchema = z.enum(['email', 'sms', 'in_app']);

const ScreenResponseSchema = z.object({
    success: z.literal(true),
    data: z.object({
        alwaysSent: z.array(z.object({
            id: z.string(), label: z.string(), channels: z.array(z.string()),
        })),
        youChoose: z.array(z.object({
            id: z.string(),
            label: z.string(),
            channels: z.object({
                email: z.string(), sms: z.string(), in_app: z.string(),
            }),
        })),
    }),
}).openapi('NotificationPreferencesScreen');

const SaveSchema = z.object({
    classId: z.string().describe('The notification class being changed, e.g. review-request.'),
    channel: ChannelSchema.describe('Which channel this choice applies to: email, sms or in_app.'),
    enabled: z.boolean().describe('True to receive it again (clears the row); false to switch it off.'),
});

const getScreenRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/notification-preferences',
    tags: ['notifications'],
    summary: 'What we send this reader, and what they can switch off',
    responses: {
        200: {
            content: { 'application/json': { schema: ScreenResponseSchema } },
            description: 'The two sections spec §4 describes.',
        },
    },
    operationId: 'getNotificationPreferences',
    description:
        'Returns the notifications addressed to the signed-in reader, split into the ones ' +
        'that cannot be switched off and the ones they choose. Channels a class never uses ' +
        'are reported as "unavailable", which is not the same as "off".',
}, { scopes: [], tier: 'extended' }));

const saveRoute = createRoute(withMcpMetadata({
    method: 'put',
    path: '/notification-preferences',
    tags: ['notifications'],
    summary: 'Switch one notification on or off for one channel',
    request: { body: { content: { 'application/json': { schema: SaveSchema } } } },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true) }) } },
            description: 'Saved.',
        },
        400: { description: 'Unknown class, or a class that cannot be switched off' },
    },
    operationId: 'saveNotificationPreference',
    description:
        'Records one explicit choice. Turning something back ON deletes the row rather than ' +
        'storing a row that restates the default. A class that is always sent is refused.',
}, { scopes: ['write'], tier: 'extended' }));

const notificationPreferenceRoutes = createApiRouter()
    .openapi(getScreenRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const userId = c.get('user')?.sub as string;
        const db = getDrizzle(c);

        const rows = await db.select({
            classId: notificationPreferences.classId,
            channel: notificationPreferences.channel,
        }).from(notificationPreferences)
            .where(and(
                eq(notificationPreferences.tenantId, tenantId),
                eq(notificationPreferences.subjectKind, 'user'),
                eq(notificationPreferences.subjectId, userId),
                eq(notificationPreferences.enabled, false),
            )).all();

        // Only the MUTES are read. A row that restates the default would make
        // the table grow with the user base instead of with the decisions (§3.2).
        const muted = new Set(rows.map((r) => `${r.classId}:${r.channel}`));
        const audience = c.get('userRole') === 'agent' ? 'agent' : 'staff';
        return c.json({ success: true as const, data: buildScreenModel(audience, muted) }, 200);
    })
    .openapi(saveRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const userId = c.get('user')?.sub as string;
        const { classId, channel, enabled } = c.req.valid('json');

        const cls = notificationClass(classId);
        if (!cls) throw Errors.BadRequest('Unknown notification.');
        // Refused at the edge as well as at the send boundary. The boundary is
        // what makes it true; this is what makes it HONEST — a screen that
        // accepts the change and then ignores it is worse than one that says no.
        if (!isSuppressible(classId)) throw Errors.BadRequest('This notification is always sent.');
        if (!cls.channels.includes(channel)) {
            throw Errors.BadRequest('This notification is not sent on that channel.');
        }
        // Same argument as the two refusals above: a class this reader is never
        // addressed by cannot take effect for them, and the row would be one
        // they could never see or clear — the screen does not render it.
        const audience = c.get('userRole') === 'agent' ? 'agent' : 'staff';
        if (!cls.audience.includes(audience) || cls.recipientFacing === false) {
            throw Errors.BadRequest('This notification is not addressed to you.');
        }

        const db = getDrizzle(c);
        const where = and(
            eq(notificationPreferences.tenantId, tenantId),
            eq(notificationPreferences.subjectKind, 'user'),
            eq(notificationPreferences.subjectId, userId),
            eq(notificationPreferences.classId, classId),
            eq(notificationPreferences.channel, channel),
        );

        if (enabled) {
            // Back to the default: delete rather than store `enabled = true`.
            await db.delete(notificationPreferences).where(where).run();
        } else {
            const now = new Date();
            await db.insert(notificationPreferences).values({
                id: nanoid(), tenantId, subjectKind: 'user', subjectId: userId,
                classId, channel, enabled: false, createdAt: now, updatedAt: now,
            }).onConflictDoNothing().run();
        }
        return c.json({ success: true as const }, 200);
    });

export default notificationPreferenceRoutes;
export type NotificationPreferencesApi = typeof notificationPreferenceRoutes;
