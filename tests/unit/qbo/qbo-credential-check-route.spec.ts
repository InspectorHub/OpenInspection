/**
 * `POST /api/integrations/qbo/credentials/check`.
 *
 * Credentials come from the merged request environment only (the request
 * middleware has already put a company's stored values there when the
 * deployment supplied none), never from the request body. The route must not
 * reach Intuit when anything it needs is missing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import type { HonoConfig } from '../../../server/types/hono';
import { AppError } from '../../../server/lib/errors';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
let storedSecrets: Record<string, string> | null = null;
vi.mock('../../../server/lib/secrets-cache', () => ({
    loadTenantSecrets: vi.fn(async () => storedSecrets),
}));
vi.mock('../../../server/lib/jwt-keyring', () => ({
    verifyJwt: vi.fn(async () => ({ sub: 'u1' })),
}));

// eslint-disable-next-line import/order
import qboRoutes from '../../../server/api/qbo';
// eslint-disable-next-line import/order
import { integrationSecretsMiddleware } from '../../../server/lib/middleware/integration-secrets';

const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PATH = '/api/integrations/qbo/credentials/check';
const ENV = {
    QBO_CLIENT_ID: 'route-client-id-distinctive',
    QBO_CLIENT_SECRET: 'route-client-secret-distinctive',
    QBO_ENV: 'sandbox',
    APP_BASE_URL: 'https://oi.example.test',
};

const intuit = vi.fn();

function buildApp(opts: { withSecretsMiddleware?: boolean } = {}) {
    const app = new Hono<HonoConfig>();
    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status);
        }
        return c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500);
    });
    app.use('*', async (c, next) => {
        c.set('tenantId', TENANT_ID);
        c.set('userRole', 'owner');
        c.set('keyringPromise', Promise.resolve({} as never));
        c.set('user', { sub: 'u1' } as never);
        c.set('services', {} as never);
        return next();
    });
    if (opts.withSecretsMiddleware) app.use('*', integrationSecretsMiddleware);
    app.route('/api/integrations/qbo', qboRoutes);
    return app;
}

async function post(env: Record<string, unknown>, opts: { body?: unknown; withSecretsMiddleware?: boolean } = {}) {
    const res = await buildApp(opts).request(PATH, {
        method: 'POST',
        headers: { Cookie: '__Host-inspector_token=stub', ...(opts.body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
    }, env);
    const text = await res.text();
    return { res, text, json: JSON.parse(text) as Record<string, any> };
}

beforeEach(() => {
    storedSecrets = null;
    intuit.mockReset();
    intuit.mockImplementation(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }));
    vi.stubGlobal('fetch', intuit);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('POST /credentials/check', () => {
    it('asks Intuit exactly once when everything is present, and returns only the verdict facts', async () => {
        const before = Math.floor(Date.now() / 1000);
        const { res, json, text } = await post(ENV);

        expect(res.status).toBe(200);
        expect(intuit).toHaveBeenCalledTimes(1);
        expect(json.success).toBe(true);
        expect(json.data.result).toBe('paired');
        expect(json.data.environment).toBe('sandbox');
        expect(json.data.checkedAt).toBeGreaterThanOrEqual(before);
        expect(json.data.checkedAt).toBeLessThanOrEqual(before + 5);
        expect(Object.keys(json.data).sort()).toEqual(['checkedAt', 'environment', 'result']);
        expect(text).not.toContain(ENV.QBO_CLIENT_ID);
        expect(text).not.toContain(ENV.QBO_CLIENT_SECRET);
        // The redirect URI is the one the connect flow registers.
        const body = new URLSearchParams(String(intuit.mock.calls[0]![1].body));
        expect(body.get('redirect_uri')).toBe('https://oi.example.test/api/integrations/qbo/callback');
    });

    it('relays rejected and unreachable verdicts', async () => {
        intuit.mockImplementationOnce(async () => new Response(JSON.stringify({ error: 'invalid_client' }), { status: 401 }));
        const rejected = await post(ENV);
        expect(rejected.json.data.result).toBe('rejected');
        intuit.mockImplementationOnce(async () => { throw new TypeError('fetch failed'); });
        const unreachable = await post(ENV);
        expect(unreachable.json.data.result).toBe('unreachable');
        // The two verdicts that carry the most detail upstream carry none of it here.
        for (const { text } of [rejected, unreachable]) {
            expect(text).not.toContain(ENV.QBO_CLIENT_ID);
            expect(text).not.toContain(ENV.QBO_CLIENT_SECRET);
            expect(text).not.toContain('invalid_client');
        }
    });

    it('answers 400 credentials_missing naming only the absent settings, and never calls Intuit', async () => {
        const noId = await post({ ...ENV, QBO_CLIENT_ID: undefined });
        const noSecret = await post({ ...ENV, QBO_CLIENT_SECRET: '' });
        const neither = await post({ APP_BASE_URL: ENV.APP_BASE_URL });

        expect(noId.res.status).toBe(400);
        expect(noId.json.error.code).toBe('credentials_missing');
        expect(noId.json.error.details).toEqual(['QBO_CLIENT_ID']);
        expect(noSecret.json.error.details).toEqual(['QBO_CLIENT_SECRET']);
        expect(neither.json.error.details).toEqual(['QBO_CLIENT_ID', 'QBO_CLIENT_SECRET']);
        expect(noSecret.text).not.toContain(ENV.QBO_CLIENT_ID);
        expect(intuit).not.toHaveBeenCalled();
    });

    it('answers 400 app_base_url_missing when the public origin is unset, and never calls Intuit', async () => {
        const { res, json } = await post({ ...ENV, APP_BASE_URL: undefined });

        expect(res.status).toBe(400);
        expect(json.error.code).toBe('app_base_url_missing');
        expect(intuit).not.toHaveBeenCalled();
    });

    it('reports the deployment environment, and null when unset or not exactly sandbox/production', async () => {
        expect((await post({ ...ENV, QBO_ENV: 'production' })).json.data.environment).toBe('production');
        expect((await post({ ...ENV, QBO_ENV: undefined })).json.data.environment).toBeNull();
        expect((await post({ ...ENV, QBO_ENV: 'Sandbox' })).json.data.environment).toBeNull();
    });

    it('ignores credentials in a request body', async () => {
        const { res, json } = await post({ APP_BASE_URL: ENV.APP_BASE_URL }, {
            body: { clientId: 'body-id', clientSecret: 'body-secret', QBO_CLIENT_ID: 'x', QBO_CLIENT_SECRET: 'y' },
        });

        expect(res.status).toBe(400);
        expect(json.error.code).toBe('credentials_missing');
        expect(intuit).not.toHaveBeenCalled();
    });

    it('limits checks per company: 429 before Intuit is asked, keyed by the company', async () => {
        const spent = { ...ENV, RATE_LIMITER: { limit: vi.fn(async () => ({ success: false })) } };
        const { res } = await post(spent);

        expect(res.status).toBe(429);
        expect(intuit).not.toHaveBeenCalled();
        expect(spent.RATE_LIMITER.limit).toHaveBeenCalledWith({ key: `qbo-credential-check:${TENANT_ID}` });

        const open = { ...ENV, RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) } };
        expect((await post(open)).res.status).toBe(200);
        expect(intuit).toHaveBeenCalledTimes(1);
    });

    it('uses credentials a company stored itself when the deployment supplies none (real secrets middleware)', async () => {
        storedSecrets = { QBO_CLIENT_ID: 'stored-id-distinctive', QBO_CLIENT_SECRET: 'stored-secret-distinctive' };
        const env = { APP_BASE_URL: ENV.APP_BASE_URL, QBO_ENV: 'sandbox', JWT_SECRET: 'x', DB: {}, TENANT_CACHE: {} };

        const { res, json } = await post(env, { withSecretsMiddleware: true });

        expect(res.status).toBe(200);
        expect(json.data.result).toBe('paired');
        expect(intuit).toHaveBeenCalledTimes(1);
        const headers = intuit.mock.calls[0]![1].headers as Record<string, string>;
        expect(headers.Authorization).toBe('Basic ' + btoa('stored-id-distinctive:stored-secret-distinctive'));

        // Control: without the middleware the same request has nothing to send.
        intuit.mockClear();
        const bare = await post(env);
        expect(bare.json.error.code).toBe('credentials_missing');
        expect(intuit).not.toHaveBeenCalled();
    });

    it('prefers the deployment value over a stored one (existing precedence, not a second rule)', async () => {
        storedSecrets = { QBO_CLIENT_ID: 'stored-id-distinctive', QBO_CLIENT_SECRET: 'stored-secret-distinctive' };
        await post({ ...ENV, JWT_SECRET: 'x', DB: {}, TENANT_CACHE: {} }, { withSecretsMiddleware: true });

        const headers = intuit.mock.calls[0]![1].headers as Record<string, string>;
        expect(headers.Authorization).toBe('Basic ' + btoa(`${ENV.QBO_CLIENT_ID}:${ENV.QBO_CLIENT_SECRET}`));
    });
});
