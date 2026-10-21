/**
 * The Google OAuth handshake of the calendar router in ../calendar.ts: GET /connect redirects the inspector to the
 * consent screen, GET /callback exchanges the code and stores the connection. Moved out of that file unchanged so it
 * stays under its size cap; calendar.ts mounts this router right after its own plain handlers, which is where these
 * two routes were registered.
 */
import { createApiRouter } from '../../lib/openapi-router';
import { CalendarCallbackQuerySchema, CalendarConnectQuerySchema } from '../../lib/validations/calendar.schema';
import { logger } from '../../lib/logger';
import { getBaseUrl } from '../../lib/url';
import { getRedirectUri } from '../../lib/google-calendar';
import { createPkceChallenge, CalendarConnectError } from '../../lib/calendar/provider';
import { getCalendarProvider } from '../../lib/calendar/registry';
import {
    CALENDAR_OAUTH_TTL_SEC,
    calendarOAuthKvKey,
    getCalendarConnection,
    upsertCalendarConnection,
    type PendingCalendarOAuth,
} from '../../lib/calendar/connection';
import {
    loadGoogleOAuthMode,
    resolveGoogleOAuthCredentials,
} from '../../lib/calendar/resolve-google-oauth';
import {
    CALENDAR_OAUTH_MESSAGE,
    renderCalendarOAuthPopupLanding,
} from '../../lib/calendar/oauth-popup-landing';
import type { Context } from 'hono';
import type { HonoConfig } from '../../types/hono';

function oauthErrorLanding(c: Context<HonoConfig>, message: string) {
    return c.html(renderCalendarOAuthPopupLanding({
        type: CALENDAR_OAUTH_MESSAGE.ERROR,
        error: message,
    }), 200);
}

function oauthConnectedLanding(c: Context<HonoConfig>) {
    return c.html(renderCalendarOAuthPopupLanding({
        type: CALENDAR_OAUTH_MESSAGE.CONNECTED,
    }), 200);
}

const calendarOAuthRoutes = createApiRouter()
    /**
     * GET /api/calendar/connect?capability=…&provider=google
     * Redirects inspector to Google OAuth consent (PKCE S256).
     */
    .get('/connect', async (c) => {
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
        const oauthMode = await loadGoogleOAuthMode(c.env.DB, tenantId);
        const oauthCreds = await resolveGoogleOAuthCredentials(c.env, tenantId, oauthMode);
        if (!oauthCreds) {
            return c.json({ success: false, error: { message: 'Google Calendar integration is not configured' } }, 501);
        }

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
        const impl = getCalendarProvider(provider);
        if (impl.connectFlow.kind !== 'redirect' || !impl.startConnect) {
            // A form provider connects through POST /connect/caldav; there is
            // nothing to redirect to.
            return c.json({ success: false, error: { message: 'Provider not implemented' } }, 501);
        }
        const authUrl = impl.startConnect({
            clientId: oauthCreds.clientId,
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
     *
     * Identity comes from the one-time KV state minted at GET /connect (when the
     * user was same-site authenticated). Google returns here via a cross-site
     * top-level navigation, so __Host-inspector_token (SameSite=Strict) is not
     * sent — same pattern as portal OIDC / core SSO handoff.
     */
    .get('/callback', async (c) => {
        const parsed = CalendarCallbackQuerySchema.safeParse(c.req.query());
        if (!parsed.success) {
            return c.json({ success: false, error: { message: 'Invalid query parameters' } }, 400);
        }
        const { code, state, error } = parsed.data;

        if (error) {
            return oauthErrorLanding(c, error);
        }
        if (!code || !state) return oauthErrorLanding(c, 'Missing authorization code or state');

        if (!c.env.TENANT_CACHE) {
            return oauthErrorLanding(c, 'Calendar OAuth is unavailable');
        }

        const pendingRaw = await c.env.TENANT_CACHE.get(calendarOAuthKvKey(state));
        if (!pendingRaw) {
            return oauthErrorLanding(c, 'OAuth session expired or invalid');
        }
        const pending = JSON.parse(pendingRaw) as PendingCalendarOAuth;
        await c.env.TENANT_CACHE.delete(calendarOAuthKvKey(state));

        const sessionUser = c.get('user');
        if (sessionUser && sessionUser.sub !== pending.userId) {
            return oauthErrorLanding(c, 'OAuth state mismatch');
        }

        const tenantId = pending.tenantId;
        const userId = pending.userId;

        const baseUrl = getBaseUrl(c);
        // The KV state check, the identity check, the sealing and the popup
        // landing stay here: none of them is the provider's business. What the
        // provider owns is the exchange and the capability it grants.
        const provider = getCalendarProvider(pending.provider);
        let connected;
        try {
            connected = await provider.completeConnect({
                tenantId,
                env: c.env,
                submission: {
                    kind: 'oauth_code',
                    code,
                    verifier: pending.verifier,
                    redirectUri: getRedirectUri(baseUrl),
                },
                requestedCapability: pending.capability,
            });
        } catch (e) {
            if (e instanceof CalendarConnectError) return oauthErrorLanding(c, e.message);
            logger.error('[calendar] Token exchange failed', {}, e instanceof Error ? e : undefined);
            return oauthErrorLanding(c, 'Failed to exchange authorization code');
        }

        const existing = await getCalendarConnection(c.env.DB, tenantId, userId, pending.provider);

        await upsertCalendarConnection({
            db: c.env.DB,
            tenantId,
            userId,
            provider: pending.provider,
            authType: connected.authType,
            capability: connected.capability,
            calendarId: connected.calendarId,
            credentials: connected.credentials,
            jwtSecret: c.env.JWT_SECRET,
            ...(c.env.JWT_SECRET_PREVIOUS ? { jwtSecretPrevious: c.env.JWT_SECRET_PREVIOUS } : {}),
            ...(existing?.credentialsDekEnc ? { existingDekEnc: existing.credentialsDekEnc } : {}),
        });

        return oauthConnectedLanding(c);
    });

export default calendarOAuthRoutes;
