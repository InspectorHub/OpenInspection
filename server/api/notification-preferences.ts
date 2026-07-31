import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { withMcpMetadata } from '../lib/route-metadata-standards';
import { getDrizzle } from '../lib/route-helpers';
import { buildScreenModel } from '../lib/notifications/screen-model';
import { Errors } from '../lib/errors';
import { applyBulk, assertChoosable, readChoices, writeChoice } from '../lib/notifications/preference-write';
import { grantSms, readSmsConsent, revokeChannel } from '../lib/notifications/channel-consent';
import { SmsConsentService } from '../services/sms-consent.service';

/**
 * The signed-in reader's own notification preferences (spec §4).
 *
 * SUBJECT COMES FROM THE SESSION, NEVER THE BODY. A preference is a statement
 * about one person, so accepting a subject id from the caller would let anyone
 * mute anyone. The route reads it from the JWT and the body carries only what
 * is being changed.
 *
 * This is the STAFF surface — an account holder inside one company, so the
 * subject is a `users` row and the tenant comes from the same JWT.
 *
 * The other two audiences cannot share it, and the reason is the same both
 * times: they have no tenant-scoped `users` row to be the subject. A partner
 * agent is a GLOBAL account (`users.tenant_id IS NULL`) whose JWT deliberately
 * carries no tenant, so their preferences are per-company and keyed on the
 * `contacts` row each company holds — `api/agent/notification-preferences.ts`.
 * A client has no account at all and authenticates by token.
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
        smsConsent: z.object({
            phone: z.string().nullable(),
            state: z.enum(['granted', 'implied', 'revoked', 'none']),
            at: z.string().nullable(),
            capturedVia: z.enum(['booking_form', 'optin_link', 'admin', 'settings_page']).nullable(),
            mode: z.enum(['express', 'implied']),
            subjects: z.array(z.object({ kind: z.enum(['contact', 'user']), id: z.string() })),
            disclosure: z.object({ version: z.number(), text: z.string() }).nullable(),
        }).nullable(),
    }),
}).openapi('NotificationPreferencesScreen');

const BulkSchema = z.object({
    action: z.enum(['enable', 'disable', 'reset'])
        .describe('enable/disable every cell in scope; reset clears them back to defaults.'),
    channel: z.enum(['email', 'sms', 'in_app']).optional()
        .describe('Limit to one channel (a column). Omit with classId for everything.'),
    classId: z.string().optional().describe('Limit to one notification (a row).'),
});

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

const bulkRoute = createRoute(withMcpMetadata({
    method: 'put',
    path: '/notification-preferences/bulk',
    tags: ['notifications'],
    summary: 'Change a whole row, column or the entire grid',
    request: { body: { content: { 'application/json': { schema: BulkSchema } } } },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true), stored: z.number() }) } },
            description: 'Applied. `stored` counts rows that differ from the default.',
        },
    },
    operationId: 'bulkSaveNotificationPreferences',
    description:
        'Applies one action to every cell in scope: a row (one notification), a column (one ' +
        'channel), or everything. Channels a notification never uses are skipped, and ' +
        'always-sent notifications are never touched.',
}, { scopes: ['write'], tier: 'extended' }));

const grantRoute = createRoute(withMcpMetadata({
    method: 'put',
    path: '/notification-preferences/sms-consent',
    tags: ['notifications'],
    summary: 'Turn text messages back on for this reader',
    request: {
        body: {
            content: {
                'application/json': {
                    schema: z.object({
                        disclosureVersion: z.number().int().optional()
                            .describe('Required for an express grant; ignored for an implied resume.'),
                    }),
                },
            },
        },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true) }) } },
            description: 'Recorded.',
        },
    },
    operationId: 'grantStaffSmsConsent',
    description:
        'Appends a granted row for the signed-in staff member. Staff are implied, so this ' +
        'withdraws an earlier stop rather than capturing consent — recorded under ' +
        'recipient_type staff so it never counts as consumer opt-in evidence.',
}, { scopes: ['write'], tier: 'extended' }));

const notificationPreferenceRoutes = createApiRouter()
    .openapi(getScreenRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const userId = c.get('user')?.sub as string;
        const db = getDrizzle(c);

        // Only DIFFERENCES from the class default are stored, so this map stays
        // small — a row that restates the default would make the table grow
        // with the user base instead of with the decisions (§3.2).
        const chosen = await readChoices(db, tenantId, 'user', userId);
        // A staff member IS a valid consent subject now — a `users` row, with
        // `contact_id` left null. They are never granted (implied, like an
        // agent); the block exists so their STOP has somewhere to land.
        const smsConsent = await readSmsConsent(
            db, tenantId, 'staff', [{ kind: 'user', id: userId }], null,
        );
        return c.json({
            success: true as const,
            data: { ...buildScreenModel('staff', chosen), smsConsent },
        }, 200);
    })
    .openapi(saveRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const userId = c.get('user')?.sub as string;
        const { classId, channel, enabled } = c.req.valid('json');

        // Refused at the edge as well as at the send boundary. The boundary is
        // what makes it true; this is what makes it HONEST — a screen that
        // accepts the change and then ignores it is worse than one that says no.
        assertChoosable(classId, 'staff');

        await writeChoice(getDrizzle(c), {
            tenantId, subjectKind: 'user', subjectId: userId, classId, channel, enabled,
        });
        return c.json({ success: true as const }, 200);
    })
    .openapi(bulkRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const userId = c.get('user')?.sub as string;
        const change = c.req.valid('json');
        const db = getDrizzle(c);
        const stored = await applyBulk(
            db, { tenantId, subjectKind: 'user', subjectId: userId }, 'staff', change,
        );
        // Stopping the whole text channel is a consent act here too — recorded
        // as `staff` basis, so it never reads as consumer evidence.
        if (change.action === 'disable' && change.channel === 'sms' && !change.classId) {
            const block = await readSmsConsent(db, tenantId, 'staff', [{ kind: 'user', id: userId }], null);
            await revokeChannel(new SmsConsentService(c.env.DB), tenantId, 'sms', block, 'staff');
        }
        return c.json({ success: true as const, stored }, 200);
    })
    .openapi(grantRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const userId = c.get('user')?.sub as string;
        const db = getDrizzle(c);
        const block = await readSmsConsent(db, tenantId, 'staff', [{ kind: 'user', id: userId }], null);
        if (!block) throw Errors.BadRequest('There is nothing to change here.');
        await grantSms(new SmsConsentService(c.env.DB), tenantId, block, 'staff', {
            ip: c.req.header('cf-connecting-ip'),
            userAgent: c.req.header('user-agent'),
        });
        return c.json({ success: true as const }, 200);
    });

export default notificationPreferenceRoutes;
export type NotificationPreferencesApi = typeof notificationPreferenceRoutes;
