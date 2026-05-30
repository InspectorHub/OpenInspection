import { Hono } from 'hono';
import { HonoConfig } from '../types/hono';
import { getCookie } from 'hono/cookie';
import { verifyJwt } from '../lib/jwt-keyring';
import { QBOTokenResponseSchema, QBOCompanyInfoResponseSchema, QBOLinkCustomerBodySchema } from '../lib/validations/qbo.schema';
import { logger } from '../lib/logger';

const api = new Hono<HonoConfig>();

// These routes serve JSON to the settings page's Alpine controller. The
// global JWT middleware in index.ts only short-circuits when no token is
// present, so we enforce auth here and respond 401 (not redirect) so the
// fetch caller sees a structured failure.
api.use('*', async (c, next) => {
    const token = getCookie(c, '__Host-inspector_token') ?? getCookie(c, 'inspector_token');
    if (!token) return c.json({ success: false, error: { code: 'unauthorized', message: 'Unauthorized' } }, 401);
    try {
        const keyring = await c.var.keyringPromise!;
        await verifyJwt(token, keyring);
        return next();
    } catch {
        return c.json({ success: false, error: { code: 'unauthorized', message: 'Unauthorized' } }, 401);
    }
});

api.get('/status', async (c) => {
    const status = await c.var.services.qbo.getConnectionStatus(c.get('tenantId'));
    return c.json({ success: true, data: status });
});

api.get('/connect', async (c) => {
    if (!c.env.QBO_CLIENT_ID || !c.env.QBO_CLIENT_SECRET) {
        return c.html('<p>QBO credentials not configured</p>', 503);
    }
    if (!c.env.APP_BASE_URL) {
        return c.html('<p>APP_BASE_URL not configured</p>', 503);
    }
    const state = crypto.randomUUID();
    await c.env.TENANT_CACHE.put(`qbo_oauth_state:${state}`, '1', { expirationTtl: 600 });
    const redirectUri = `${c.env.APP_BASE_URL}/settings/integrations/qbo/callback`;
    const url = new URL('https://appcenter.intuit.com/connect/oauth2');
    url.searchParams.set('client_id', c.env.QBO_CLIENT_ID);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'com.intuit.quickbooks.accounting');
    url.searchParams.set('state', state);
    return c.redirect(url.toString());
});

api.get('/callback', async (c) => {
    const code = c.req.query('code') ?? '';
    const state = c.req.query('state') ?? '';
    const realmId = c.req.query('realmId') ?? '';
    const error = c.req.query('error');

    if (error) return c.redirect('/settings/integrations/qbo?error=' + encodeURIComponent(error));

    if (!c.env.QBO_CLIENT_ID || !c.env.QBO_CLIENT_SECRET || !c.env.APP_BASE_URL) {
        return c.redirect('/settings/integrations/qbo?error=not_configured');
    }

    const stored = await c.env.TENANT_CACHE.get(`qbo_oauth_state:${state}`);
    if (!stored) return c.redirect('/settings/integrations/qbo?error=invalid_state');
    await c.env.TENANT_CACHE.delete(`qbo_oauth_state:${state}`);

    const redirectUri = `${c.env.APP_BASE_URL}/settings/integrations/qbo/callback`;
    const basicAuth = 'Basic ' + btoa(`${c.env.QBO_CLIENT_ID}:${c.env.QBO_CLIENT_SECRET}`);

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
        const tenantId = c.get('tenantId');

        let companyName: string | null = null;
        try {
            const infoResp = await fetch(
                `https://quickbooks.api.intuit.com/v3/company/${realmId}/companyinfo/${realmId}?minorversion=75`,
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
        logger.error('QBO OAuth callback failed', { realmId }, e instanceof Error ? e : undefined);
        return c.redirect('/settings/integrations/qbo?error=oauth_failed');
    }
});

api.post('/disconnect', async (c) => {
    await c.var.services.qbo.disconnect(c.get('tenantId'));
    return c.json({ success: true });
});

api.post('/pause', async (c) => {
    const result = await c.var.services.qbo.setSyncEnabled(c.get('tenantId'));
    if (result === null) return c.json({ success: false, error: { code: 'not_connected', message: 'Not connected' } }, 404);
    return c.json({ success: true, data: { syncEnabled: result } });
});

api.post('/sync', async (c) => {
    const tenantId = c.get('tenantId');
    const svc = c.var.services.qbo;
    const invoiceSvc = c.var.services.invoice;
    c.executionCtx.waitUntil(
        svc.runCDCSync(
            tenantId,
            (invoiceId, tid) => invoiceSvc.markPaid(invoiceId, tid, 'qbo'),
            (invoiceId, _balance, tid) => invoiceSvc.markPartial(invoiceId, tid, 'qbo'),
        ),
    );
    return c.json({ success: true, data: { message: 'Sync started' } });
});

api.post('/errors/:id/retry', async (c) => {
    await c.var.services.qbo.resolveError(c.get('tenantId'), c.req.param('id'));
    return c.json({ success: true });
});

api.post('/contacts/:contactId/link', async (c) => {
    const parsed = QBOLinkCustomerBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ success: false, error: { code: 'validation_error', message: 'Invalid body' } }, 400);
    await c.var.services.qbo.linkExistingCustomer(c.get('tenantId'), c.req.param('contactId'), parsed.data.qboCustomerId);
    return c.json({ success: true });
});

export default api;
