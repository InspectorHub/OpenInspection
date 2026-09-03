import { Hono } from 'hono';
import type { HonoConfig } from '../types/hono';
import { requireRole } from '../lib/middleware/rbac';
import { QBOTokenResponseSchema, QBOCompanyInfoResponseSchema } from '../lib/validations/qbo.schema';
import { logger } from '../lib/logger';
import { AppError, ErrorCode } from '../lib/errors';
import { qboRedirectUri } from '../lib/qbo-oauth-paths';
import { resolveQboApiBase } from '../services/qbo/api-base';
import { loadTenantSecrets } from '../lib/secrets-cache';
import { applyIntegrationSecrets } from '../lib/middleware/integration-secrets';

/**
 * The two halves of the QuickBooks OAuth handshake that a BROWSER walks
 * through, split out from the rest of the QBO admin router (`api/qbo.ts`) and
 * mounted under `/api/integrations/qbo`.
 *
 * They live here, and not with their siblings, because they are the only QBO
 * routes the outside world navigates to. The siblings (`/status`, `/pause`,
 * `/sync`, …) are fetched by the settings page through the in-process
 * `API_WORKER` binding.
 *
 * NOTE: no router-wide `use('*')` middleware. The guards are per-route. That is
 * load-bearing again: `api/qbo.ts` now shares this mount prefix, and ITS two
 * router-wide guards re-register across the whole prefix — these two routes
 * included. `server/index.ts` therefore mounts this router FIRST, so a
 * cookie-less `/callback` from Intuit is answered here rather than 401'd by a
 * session check meant for the management API. Pinned by
 * `tests/unit/routing/qbo-api-mount.spec.ts`.
 */
const api = new Hono<HonoConfig>();

/**
 * Authenticated entry point — keeps the owner/manager guard the rest of the QBO
 * router carries (see the rationale in `api/qbo.ts`). Connecting company books
 * is company-level administration, and this is the door.
 *
 * The global JWT middleware has already verified the cookie and set `userRole`
 * by the time this runs; `requireRole` also refuses a caller with no role,
 * which is what an agent (client/realtor) JWT is.
 */
api.get('/connect', requireRole('owner', 'manager'), async (c) => {
    if (!c.env.QBO_CLIENT_ID || !c.env.QBO_CLIENT_SECRET) {
        return c.redirect('/settings/integrations/qbo?error=not_configured', 302);
    }
    if (!c.env.APP_BASE_URL) {
        return c.redirect('/settings/integrations/qbo?error=missing_base_url', 302);
    }

    const state = crypto.randomUUID();
    // The state IS the callback's authorization, so it carries the tenant.
    //
    // Why that is safe: this value is a server-generated UUID, single-use (the
    // callback deletes it before doing anything with it), expires in 600
    // seconds, and is only ever issued to a caller who has just passed the
    // owner/manager guard above. Possession of a valid state is therefore proof
    // that an owner or manager initiated this exchange — which is precisely
    // what the OAuth `state` parameter is for. It is never sent to the browser
    // as a credential for anything else, and it grants exactly one action:
    // finishing the handshake it was minted for.
    //
    // It cannot be a session instead: Intuit sends the user back as a
    // cross-site top-level navigation, and `__Host-inspector_token` is
    // `SameSite=Strict` (`lib/auth-helpers.ts`), so the cookie is withheld on
    // exactly that navigation. There is no session on the callback to read.
    await c.env.TENANT_CACHE.put(`qbo_oauth_state:${state}`, c.get('tenantId'), { expirationTtl: 600 });

    const url = new URL('https://appcenter.intuit.com/connect/oauth2');
    url.searchParams.set('client_id', c.env.QBO_CLIENT_ID);
    url.searchParams.set('redirect_uri', qboRedirectUri(c.env.APP_BASE_URL));
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'com.intuit.quickbooks.accounting');
    url.searchParams.set('state', state);
    return c.redirect(url.toString());
});

/**
 * UNAUTHENTICATED by design — declared public in `lib/middleware/jwt-auth.ts`
 * (the same list that exempts the QBO webhook), and authorized by `state`.
 * See the note on `/connect` for why a session cannot reach this handler.
 */
api.get('/callback', async (c) => {
    const code = c.req.query('code') ?? '';
    const state = c.req.query('state') ?? '';
    const realmId = c.req.query('realmId') ?? '';
    const error = c.req.query('error');

    // These redirects point at the React Router settings PAGE, which is where
    // the user should end up — not back into this API family.
    if (error) return c.redirect('/settings/integrations/qbo?error=' + encodeURIComponent(error));
    if (!c.env.APP_BASE_URL) return c.redirect('/settings/integrations/qbo?error=not_configured');

    const tenantId = await c.env.TENANT_CACHE.get(`qbo_oauth_state:${state}`);
    if (!tenantId) return c.redirect('/settings/integrations/qbo?error=invalid_state');
    // Burn it before use: a replayed callback must not be able to write a
    // second connection, and the window closes even if the exchange below
    // throws.
    await c.env.TENANT_CACHE.delete(`qbo_oauth_state:${state}`);
    c.set('tenantId', tenantId);

    // Every QuickBooks credential can be a per-tenant secret (Settings ->
    // Integrations), and `integrationSecretsMiddleware` only merges those into
    // `c.env` once a tenant is known. On this request the tenant was unknown
    // until the line above — in saas mode nothing upstream could resolve it —
    // so load them here for the tenant the state names.
    //
    // UNCONDITIONALLY. This used to be guarded by
    // `if (!QBO_CLIENT_ID || !QBO_CLIENT_SECRET)`, which was a second, partial
    // copy of a precedence rule `applyIntegrationSecrets` already owns: env
    // wins, the tenant row is the fallback, so the merge is already a no-op
    // when env has the value. The guard named two of the four keys, so an
    // operator with the id and secret on the Worker env but `QBO_ENV` on the
    // settings form skipped the merge entirely and got `?error=missing_qbo_env`
    // with that field correctly filled in.
    //
    // The comment here previously said the guard was "a no-op when env already
    // has them, which is the standalone case" — with the modes inverted.
    // Standalone is precisely the deployment where env has NOTHING: Intuit
    // matches a redirect URI byte for byte, so the platform's app cannot serve
    // someone else's domain and the operator registers their own.
    {
        const decrypted = await loadTenantSecrets(
            c.env.DB, c.env.TENANT_CACHE, tenantId, c.env.JWT_SECRET, c.env.JWT_SECRET_PREVIOUS,
        ).catch(() => null);
        // Onto a COPY, never onto `c.env` itself: the runtime reuses one `env`
        // object for every request in an isolate, so an in-place write would
        // leave this tenant's client secret there for the next one. Same reason
        // the secrets middleware copies — see the note there.
        if (decrypted) {
            const perRequest = { ...c.env };
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            applyIntegrationSecrets(perRequest as any, decrypted as Record<string, string | undefined>);
            c.env = perRequest;
        }
    }
    // `c.env` is final from here — the merge above may have replaced it with a
    // per-request copy, which is why these are read once into locals rather
    // than off the context repeatedly. The earlier guards narrowed an object
    // that no longer exists.
    const { QBO_CLIENT_ID: clientId, QBO_CLIENT_SECRET: clientSecret, APP_BASE_URL: appBaseUrl } = c.env;
    if (!clientId || !clientSecret || !appBaseUrl) {
        return c.redirect('/settings/integrations/qbo?error=not_configured');
    }

    // Which Intuit host this deployment talks to. Checked here rather than
    // after the exchange: connecting sandbox books with no QBO_ENV would store
    // a working token against an API the worker refuses to call, and the
    // integration would look connected while syncing nothing.
    let apiBase: string;
    try {
        apiBase = resolveQboApiBase(c.env.QBO_ENV);
    } catch {
        // Its own code, not the credential one. Whoever sets QBO_ENV differs by
        // deployment — a self-hoster does it on the settings form beside their
        // own credentials, a platform tenant never sees it at all — but in
        // neither case is a missing Client ID the problem, and sending the
        // reader to a field that is already correct is how they lose an hour.
        return c.redirect('/settings/integrations/qbo?error=missing_qbo_env');
    }

    // Byte-identical to the value `/connect` authorized with, and to what is
    // registered on the Intuit app — one function, no second literal.
    const redirectUri = qboRedirectUri(appBaseUrl);
    const basicAuth = 'Basic ' + btoa(`${clientId}:${clientSecret}`);

    try {
        const tokenResp = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
            method: 'POST',
            headers: {
                Authorization: basicAuth,
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/json',
            },
            body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
        });
        if (!tokenResp.ok) throw new Error('Token exchange failed');
        const tokens = QBOTokenResponseSchema.parse(await tokenResp.json());

        let companyName: string | null = null;
        try {
            const infoResp = await fetch(
                `${apiBase}/${realmId}/companyinfo/${realmId}?minorversion=75`,
                { headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: 'application/json' } },
            );
            if (infoResp.ok) {
                const info = QBOCompanyInfoResponseSchema.parse(await infoResp.json());
                companyName = info.CompanyInfo.CompanyName;
            }
        } catch { /* non-fatal: company name is a UX nicety */ }

        const svc = c.var.services.qbo;
        await svc.saveConnection({
            tenantId,
            realmId,
            companyName,
            accessToken:           tokens.access_token,
            refreshToken:          tokens.refresh_token,
            refreshTokenExpiresIn: tokens.x_refresh_token_expires_in,
        });
        c.executionCtx.waitUntil(svc.bootstrapDefaultItem(tenantId));

        return c.redirect('/settings/integrations/qbo?connected=1');
    } catch (e) {
        // A realm already bound to another workspace is not a broken round
        // trip — Intuit said yes and we refused, and the tenant can act on
        // that. Reporting it as `oauth_failed` would send them to re-check
        // credentials that are fine.
        if (e instanceof AppError && e.code === ErrorCode.CONFLICT) {
            logger.warn('QBO OAuth callback refused — realm already connected elsewhere', { realmId });
            return c.redirect('/settings/integrations/qbo?error=realm_already_connected');
        }
        logger.error('QBO OAuth callback failed', { realmId }, e instanceof Error ? e : undefined);
        return c.redirect('/settings/integrations/qbo?error=oauth_failed');
    }
});

export default api;
