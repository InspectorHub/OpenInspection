/**
 * `paymentsAvailable` on GET /book/{tenant}: a boolean that is true only when the company's OWN Stripe account holds all three
 * keys. The booking page uses it to decide whether to quote a deposit and offer a Pay button, so a partial set must read false
 * (the deposit-intent route answers 503 without the secret and publishable keys, and a payment with no webhook is never recorded).
 * The response carries the boolean and never a key.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import { tenants, tenantConfigs } from '../../../server/lib/db/schema';
import * as schema from '../../../server/lib/db/schema';
import type { HonoConfig } from '../../../server/types/hono';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
vi.mock('../../../server/lib/rate-limit', () => ({ checkRateLimit: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../../server/lib/secrets-cache', () => ({ loadTenantSecrets: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { loadTenantSecrets } from '../../../server/lib/secrets-cache';
// eslint-disable-next-line import/order
import { bookingsRoutes } from '../../../server/api/bookings';

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-0000000000b2';
const SLUG = 'acme-pay';
const ENV = { DB: {}, JWT_SECRET: 'x'.repeat(32) } as unknown as HonoConfig['Bindings'];
const ALL = { STRIPE_PUBLISHABLE_KEY: 'pk_test_1', STRIPE_SECRET_KEY: 'sk_test_1', STRIPE_WEBHOOK_SECRET: 'whsec_1' };

describe('GET /book/{tenant} paymentsAvailable', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];
    const load = loadTenantSecrets as unknown as ReturnType<typeof vi.fn>;

    function buildApp(envCredentialsAreCompanyOwn: boolean) {
        const app = new OpenAPIHono<HonoConfig>();
        app.use('*', async (c, next) => {
            c.set('services', { booking: { getQualifiedInspectorIds: vi.fn().mockResolvedValue([]) } } as unknown as HonoConfig['Variables']['services']);
            c.set('profile', { envCredentialsAreCompanyOwn } as unknown as HonoConfig['Variables']['profile']);
            await next();
        });
        app.route('/', bookingsRoutes);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
        return app;
    }

    async function read(app: OpenAPIHono<HonoConfig>, env = ENV) {
        const res = await app.request(`/book/${SLUG}`, {}, env);
        expect(res.status).toBe(200);
        const text = await res.text();
        return { text, body: JSON.parse(text) as { data: { paymentsAvailable: unknown } } };
    }

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db as BetterSQLite3Database<typeof schema>;
        sqlite = fixture.sqlite;
        await setupSchema(sqlite);
        await db.insert(tenants).values({
            id: TENANT_ID, slug: SLUG, tier: 'free', status: 'active', maxUsers: 5, deploymentMode: 'shared', createdAt: new Date(),
        } as never);
        await db.insert(tenantConfigs).values({ tenantId: TENANT_ID, companyName: 'Acme Pay', updatedAt: new Date() } as never);
        load.mockReset();
    });

    afterEach(() => {
        sqlite.close();
    });

    it('is true when the company stored all three keys, and the response holds no key', async () => {
        load.mockResolvedValue({ ...ALL });
        const { body, text } = await read(buildApp(false));
        expect(body.data.paymentsAvailable).toBe(true);
        for (const v of Object.values(ALL)) expect(text).not.toContain(v);
        expect(load).toHaveBeenCalledWith(ENV.DB, undefined, TENANT_ID, ENV.JWT_SECRET, undefined);
    });

    it.each([
        ['no secret key', { STRIPE_PUBLISHABLE_KEY: 'pk', STRIPE_WEBHOOK_SECRET: 'wh' }],
        ['no publishable key', { STRIPE_SECRET_KEY: 'sk', STRIPE_WEBHOOK_SECRET: 'wh' }],
        ['no webhook secret', { STRIPE_SECRET_KEY: 'sk', STRIPE_PUBLISHABLE_KEY: 'pk' }],
        ['a blank key', { ...ALL, STRIPE_SECRET_KEY: '  ' }],
    ])('is false for a partial set (%s)', async (_label, secrets) => {
        load.mockResolvedValue(secrets);
        expect((await read(buildApp(false))).body.data.paymentsAvailable).toBe(false);
    });

    it('is false when nothing is stored, and when the stored blob cannot be read', async () => {
        load.mockResolvedValue(null);
        expect((await read(buildApp(false))).body.data.paymentsAvailable).toBe(false);
        load.mockRejectedValue(new Error('decrypt failed'));
        expect((await read(buildApp(false))).body.data.paymentsAvailable).toBe(false);
    });

    it('does not count a deployment-wide Stripe key on a hosted deployment', async () => {
        load.mockResolvedValue({ STRIPE_PUBLISHABLE_KEY: 'pk', STRIPE_WEBHOOK_SECRET: 'wh' });
        const env = { ...ENV, STRIPE_SECRET_KEY: 'sk_platform' } as HonoConfig['Bindings'];
        expect((await read(buildApp(false), env)).body.data.paymentsAvailable).toBe(false);
    });

    it('counts the deployment secret key when the deployment is the company (self-host), as the overview card does', async () => {
        load.mockResolvedValue({ STRIPE_PUBLISHABLE_KEY: 'pk', STRIPE_WEBHOOK_SECRET: 'wh' });
        const env = { ...ENV, STRIPE_SECRET_KEY: 'sk_own' } as HonoConfig['Bindings'];
        expect((await read(buildApp(true), env)).body.data.paymentsAvailable).toBe(true);
    });
});
