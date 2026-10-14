/**
 * `GET /status` adds the origin of each credential to what the service returns.
 *
 * The service only ever sees the merged environment (the request middleware has
 * already written the company's stored values into it), so it cannot tell where
 * a value came from. The router can: the middleware records which keys it filled
 * from the stored values. This spec drives the real router with a stubbed service
 * and asserts the origins, and that the response carries no credential value.
 */
import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import type { HonoConfig } from '../../../server/types/hono';
import { AppError } from '../../../server/lib/errors';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
// What the company stored, as the middleware would decrypt it.
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

const SERVICE_STATUS = { realmId: 'r1', environment: 'sandbox', mappedCustomers: 2 };

function buildApp(opts: { tenantKeys?: string[]; status?: unknown }) {
    const qbo = {
        getConnectionStatus: vi.fn(async () => (opts.status === undefined ? SERVICE_STATUS : opts.status)),
    };
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
        c.set('services', { qbo } as never);
        if (opts.tenantKeys) c.set('tenantSecretKeys', opts.tenantKeys);
        return next();
    });
    app.route('/api/integrations/qbo', qboRoutes);
    return { app, qbo };
}

async function getStatus(opts: { tenantKeys?: string[]; status?: unknown }, env: Record<string, unknown>) {
    const { app } = buildApp(opts);
    const res = await app.request('/api/integrations/qbo/status', {
        method: 'GET', headers: { Cookie: '__Host-inspector_token=stub' },
    }, env);
    const text = await res.text();
    return { res, text, body: JSON.parse(text) as { success: boolean; data: Record<string, unknown> | null } };
}

const ENV = {
    QBO_CLIENT_ID: 'id-from-somewhere',
    QBO_CLIENT_SECRET: 'secret-from-somewhere',
    QBO_WEBHOOK_SECRET: 'webhook-from-somewhere',
    QBO_ENV: 'sandbox',
};

describe('GET /status credentialSource', () => {
    it('keeps every field the service returned and adds the origins', async () => {
        const { body } = await getStatus({ tenantKeys: [] }, ENV);

        expect(body.data).toMatchObject(SERVICE_STATUS);
        expect(body.data?.credentialSource).toEqual({
            clientId: 'env', clientSecret: 'env', webhookToken: 'env', environment: 'env',
        });
    });

    it('marks the keys the middleware filled from the stored values as tenant', async () => {
        const { body } = await getStatus({ tenantKeys: ['QBO_CLIENT_SECRET', 'QBO_WEBHOOK_SECRET'] }, ENV);

        expect(body.data?.credentialSource).toEqual({
            clientId: 'env', clientSecret: 'tenant', webhookToken: 'tenant', environment: 'env',
        });
    });

    it('reports missing for what is unset, and treats a request the middleware skipped as env-only', async () => {
        const { body } = await getStatus({}, { QBO_CLIENT_ID: 'id' });

        expect(body.data?.credentialSource).toEqual({
            clientId: 'env', clientSecret: 'missing', webhookToken: 'missing', environment: 'missing',
        });
    });

    it('never puts a credential value, or a mask of one, in the response', async () => {
        const { text } = await getStatus({ tenantKeys: ['QBO_CLIENT_SECRET'] }, ENV);
        // Positive control: the same text does carry the origins, so an empty
        // or unrelated body cannot pass the absence checks below.
        expect(text).toContain('credentialSource');

        for (const secret of [ENV.QBO_CLIENT_ID, ENV.QBO_CLIENT_SECRET, ENV.QBO_WEBHOOK_SECRET]) {
            expect(text).not.toContain(secret);
        }
        expect(text).not.toContain('••');
    });

    it('stays null when there is no connection, rather than inventing a status around the origins', async () => {
        const { body } = await getStatus({ tenantKeys: [], status: null }, ENV);

        expect(body).toEqual({ success: true, data: null });
    });
});

describe('GET /status through the real secrets middleware', () => {
    // The two halves are joined only by the name of a context variable, so each
    // half passing alone proves nothing about the pair. This one runs both.
    function chainApp() {
        const qbo = { getConnectionStatus: vi.fn(async () => SERVICE_STATUS) };
        const app = new Hono<HonoConfig>();
        app.use('*', async (c, next) => {
            c.set('tenantId', TENANT_ID);
            c.set('userRole', 'owner');
            c.set('keyringPromise', Promise.resolve({} as never));
            c.set('user', { sub: 'u1' } as never);
            c.set('services', { qbo } as never);
            return next();
        });
        app.use('*', integrationSecretsMiddleware);
        app.route('/api/integrations/qbo', qboRoutes);
        return app;
    }

    const run = async (env: Record<string, unknown>) => {
        const res = await chainApp().request('/api/integrations/qbo/status', {
            method: 'GET', headers: { Cookie: '__Host-inspector_token=stub' },
        }, { DB: {}, TENANT_CACHE: {}, JWT_SECRET: 'unit-test-secret-0123456789abcdef', ...env });
        return (await res.json()) as { data: { credentialSource: Record<string, string> } };
    };

    it('says tenant for a value the company stored when the deployment holds none', async () => {
        storedSecrets = { QBO_CLIENT_ID: 'stored-id', QBO_CLIENT_SECRET: 'stored-secret' };

        const { data } = await run({ QBO_CLIENT_SECRET: 'deployment-secret' });

        expect(data.credentialSource).toMatchObject({ clientId: 'tenant', clientSecret: 'env' });
    });

    it('says env for everything when the company stored nothing (positive control)', async () => {
        storedSecrets = null;

        const { data } = await run({ QBO_CLIENT_ID: 'a', QBO_CLIENT_SECRET: 'b' });

        expect(data.credentialSource).toMatchObject({ clientId: 'env', clientSecret: 'env', webhookToken: 'missing' });
    });
});
