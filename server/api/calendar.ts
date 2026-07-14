import { createRoute } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import { availabilityOverrides } from '../lib/db/schema/inspection';
import {
    CalendarSyncResponseSchema,
    CalendarCallbackQuerySchema,
    CalendarConnectQuerySchema,
} from '../lib/validations/calendar.schema';
import { SuccessResponseSchema } from '../lib/validations/shared.schema';
import { logger } from '../lib/logger';
import { getBaseUrl } from '../lib/url';
import { withMcpMetadata } from '../lib/route-metadata-standards';
import { getRedirectUri, syncEventsToGcal, createCalendarEvent } from '../lib/google-calendar';
import {
    canPushEvents,
    capabilityFromScopes,
    createPkceChallenge,
} from '../lib/calendar/provider';
import { getCalendarProvider } from '../lib/calendar/registry';
import {
    CALENDAR_OAUTH_TTL_SEC,
    calendarOAuthKvKey,
    deleteCalendarConnection,
    getCalendarConnection,
    loadOpenGoogleConnection,
    upsertCalendarConnection,
    type PendingCalendarOAuth,
} from '../lib/calendar/connection';

/**
 * DELETE /api/calendar/disconnect
 * Removes stored calendar connection for the current user.
 */
const disconnectRoute = createRoute(withMcpMetadata({
    method: 'delete',
    path: '/disconnect',
    operationId: 'disconnectGoogleCalendar',
    tags: ['calendar'],
    summary: 'Disconnect Google Calendar integration',
    description: 'Deletes the encrypted calendar_connections row for the current inspector. Future syncs fail until they reconnect.',
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: SuccessResponseSchema.describe('Disconnect acknowledgement'),
                },
            },
            description: 'Success',
        },
        401: { description: 'Unauthorized' },
    },
    security: [{ bearerAuth: [] }],
}, { scopes: ['write'], tier: 'extended' }));

/**
 * POST /api/calendar/sync
 * Pulls busy blocks from the connected calendar provider.
 */
const syncRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/sync',
    operationId: 'syncGoogleCalendarBusyBlocks',
    tags: ['calendar'],
    summary: 'Sync busy blocks from Google Calendar',
    description: 'Pulls upcoming busy time blocks from the inspector\'s connected calendar and merges them into availability overrides.',
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: CalendarSyncResponseSchema.describe('Busy sync summary'),
                },
            },
            description: 'Success',
        },
        400: { description: 'Calendar not connected' },
        401: { description: 'Unauthorized' },
        500: { description: 'Internal server error' },
    },
    security: [{ bearerAuth: [] }],
}, { scopes: ['write'], tier: 'extended' }));

export const calendarRoutes = createApiRouter()
    .openapi(disconnectRoute, async (c) => {
        const user = c.get('user');
        if (!user) return c.json({ success: false, error: { message: 'Not authenticated' } }, 401);

        const tenantId = c.get('tenantId') as string;
        await deleteCalendarConnection(c.env.DB, tenantId, user.sub, 'google');
        return c.json({ success: true }, 200);
    })
    .openapi(syncRoute, async (c) => {
        const jwtUser = c.get('user');
        if (!jwtUser) return c.json({ success: false, error: { message: 'Not authenticated' } }, 401);

        const tenantId = c.get('tenantId') as string;
        const open = await loadOpenGoogleConnection(
            c.env.DB,
            tenantId,
            jwtUser.sub,
            c.env.JWT_SECRET,
            c.env.JWT_SECRET_PREVIOUS,
        );
        if (!open) {
            return c.json({ success: false, error: { message: 'Google Calendar not connected' } }, 400);
        }

        const provider = getCalendarProvider('google');
        const timeMin = new Date();
        const timeMax = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        let busyBlocks;
        try {
            busyBlocks = await provider.listBusy({
                clientId: c.env.GOOGLE_CLIENT_ID,
                clientSecret: c.env.GOOGLE_CLIENT_SECRET,
                refreshToken: open.credentials.refreshToken,
                calendarId: open.connection.calendarId,
                range: { from: timeMin, to: timeMax },
                capability: open.connection.capabilities,
            });
        } catch (e) {
            logger.error('[calendar] sync listBusy failed', { tenantId }, e instanceof Error ? e : undefined);
            return c.json({ success: false, error: { message: 'Failed to fetch Google Calendar busy blocks' } }, 500);
        }

        const db = drizzle(c.env.DB);
        const inspectorId = jwtUser.sub;
        let created = 0;

        for (const block of busyBlocks) {
            const date = block.start.slice(0, 10);
            const existing = await db.select({ id: availabilityOverrides.id })
                .from(availabilityOverrides)
                .where(and(
                    eq(availabilityOverrides.tenantId, tenantId),
                    eq(availabilityOverrides.inspectorId, inspectorId),
                    eq(availabilityOverrides.date, date),
                ))
                .limit(1);
            if (existing.length) continue;

            await db.insert(availabilityOverrides).values({
                id: crypto.randomUUID(),
                tenantId,
                inspectorId,
                date,
                isAvailable: false,
                startTime: null,
                endTime: null,
                createdAt: new Date(),
            });
            created++;
        }

        return c.json({
            success: true,
            data: { blockedDatesCreated: created, totalEvents: busyBlocks.length },
        }, 200);
    })
    /**
     * POST /api/calendar/sync-events
     * Pushes upcoming inspection events to Google Calendar (full-sync capability only).
     */
    .post('/sync-events', async (c) => {
        const jwtUser = c.get('user');
        if (!jwtUser) return c.json({ success: false, error: { message: 'Not authenticated' } }, 401);

        const tenantId = c.get('tenantId') as string;
        const open = await loadOpenGoogleConnection(
            c.env.DB,
            tenantId,
            jwtUser.sub,
            c.env.JWT_SECRET,
            c.env.JWT_SECRET_PREVIOUS,
        );
        if (!open) {
            return c.json({ success: false, error: { message: 'Google Calendar not connected' } }, 400);
        }
        if (!canPushEvents(open.connection.capabilities)) {
            return c.json({
                success: false,
                error: { message: 'Calendar connection does not include write access. Reconnect with full sync.' },
            }, 403);
        }

        const result = await syncEventsToGcal(
            c.env.DB,
            tenantId,
            c.env.GOOGLE_CLIENT_ID,
            c.env.GOOGLE_CLIENT_SECRET,
            open.credentials.refreshToken,
            open.connection.calendarId,
        );
        return c.json({ success: true, data: result });
    })
    /**
     * GET /api/calendar/connect?capability=…&provider=google
     * Redirects inspector to Google OAuth consent (PKCE S256).
     */
    .get('/connect', async (c) => {
        if (!c.env.GOOGLE_CLIENT_ID) {
            return c.json({ success: false, error: { message: 'Google Calendar integration is not configured' } }, 501);
        }

        const user = c.get('user');
        if (!user) return c.redirect('/login');

        const parsed = CalendarConnectQuerySchema.safeParse(c.req.query());
        if (!parsed.success) {
            return c.json({ success: false, error: { message: 'Invalid connect parameters' } }, 400);
        }
        const { capability, provider } = parsed.data;
        if (provider !== 'google') {
            return c.json({ success: false, error: { message: 'Provider not implemented' } }, 501);
        }

        const tenantId = c.get('tenantId') as string;
        if (!c.env.TENANT_CACHE) {
            return c.json({ success: false, error: { message: 'Calendar OAuth is unavailable' } }, 503);
        }

        const pkce = await createPkceChallenge();
        const state = crypto.randomUUID();
        const pending: PendingCalendarOAuth = {
            userId: user.sub,
            tenantId,
            verifier: pkce.verifier,
            capability,
            provider,
        };
        await c.env.TENANT_CACHE.put(
            calendarOAuthKvKey(state),
            JSON.stringify(pending),
            { expirationTtl: CALENDAR_OAUTH_TTL_SEC },
        );

        const baseUrl = getBaseUrl(c);
        const authUrl = getCalendarProvider(provider).getAuthUrl({
            clientId: c.env.GOOGLE_CLIENT_ID,
            redirectUri: getRedirectUri(baseUrl),
            state,
            pkce,
            capability,
        });
        return c.redirect(authUrl.toString());
    })
    /**
     * GET /api/calendar/callback
     * Exchanges OAuth code, stores encrypted credentials in calendar_connections.
     */
    .get('/callback', async (c) => {
        const parsed = CalendarCallbackQuerySchema.safeParse(c.req.query());
        if (!parsed.success) {
            return c.json({ success: false, error: { message: 'Invalid query parameters' } }, 400);
        }
        const { code, state, error } = parsed.data;

        if (error) {
            return c.redirect(`/settings/communication?calendar_error=${encodeURIComponent(error)}`, 302);
        }
        if (!code || !state) return c.json({ success: false, error: { message: 'Missing code or state' } }, 400);

        const user = c.get('user');
        if (!user) return c.redirect('/login');

        if (!c.env.TENANT_CACHE) {
            return c.json({ success: false, error: { message: 'Calendar OAuth is unavailable' } }, 503);
        }

        const pendingRaw = await c.env.TENANT_CACHE.get(calendarOAuthKvKey(state));
        if (!pendingRaw) {
            return c.json({ success: false, error: { message: 'OAuth session expired or invalid' } }, 403);
        }
        const pending = JSON.parse(pendingRaw) as PendingCalendarOAuth;
        await c.env.TENANT_CACHE.delete(calendarOAuthKvKey(state));

        if (pending.userId !== user.sub) {
            return c.json({ success: false, error: { message: 'OAuth state mismatch' } }, 403);
        }

        const tenantId = c.get('tenantId') as string;
        if (pending.tenantId !== tenantId) {
            return c.json({ success: false, error: { message: 'OAuth tenant mismatch' } }, 403);
        }

        const baseUrl = getBaseUrl(c);
        const provider = getCalendarProvider(pending.provider);
        let exchange;
        try {
            exchange = await provider.exchangeCode({
                clientId: c.env.GOOGLE_CLIENT_ID,
                clientSecret: c.env.GOOGLE_CLIENT_SECRET,
                redirectUri: getRedirectUri(baseUrl),
                code,
                verifier: pending.verifier,
            });
        } catch (e) {
            logger.error('[calendar] Token exchange failed', {}, e instanceof Error ? e : undefined);
            return c.json({ success: false, error: { message: 'Failed to exchange authorization code' } }, 500);
        }

        if (!exchange.credentials.refreshToken) {
            return c.json({ success: false, error: { message: 'Google did not return a refresh token' } }, 500);
        }

        const derivedCapability = exchange.scopes.length
            ? capabilityFromScopes(exchange.scopes)
            : pending.capability;

        const existing = await getCalendarConnection(c.env.DB, tenantId, user.sub, 'google');

        await upsertCalendarConnection({
            db: c.env.DB,
            tenantId,
            userId: user.sub,
            provider: pending.provider,
            authType: 'oauth',
            capability: derivedCapability,
            calendarId: exchange.calendarId,
            credentials: {
                refreshToken: exchange.credentials.refreshToken,
                scopes: exchange.scopes,
                ...(exchange.credentials.accessToken ? { accessToken: exchange.credentials.accessToken } : {}),
                ...(exchange.credentials.expiresAt ? { expiresAt: exchange.credentials.expiresAt } : {}),
            },
            jwtSecret: c.env.JWT_SECRET,
            ...(c.env.JWT_SECRET_PREVIOUS ? { jwtSecretPrevious: c.env.JWT_SECRET_PREVIOUS } : {}),
            ...(existing?.credentialsDekEnc ? { existingDekEnc: existing.credentialsDekEnc } : {}),
        });

        return c.redirect('/settings/communication?calendar=connected');
    });

export type CalendarApi = typeof calendarRoutes;

export { createCalendarEvent, syncEventsToGcal };

export default calendarRoutes;
