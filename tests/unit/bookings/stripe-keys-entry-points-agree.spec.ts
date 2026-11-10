/**
 * The two public payment entry points must share ONE definition of "the company's Stripe keys are complete":
 *
 *   - GET  /book/{tenant}                         -> `paymentsAvailable` (whether the page offers a Pay button)
 *   - POST /api/public/inspections/{id}/deposit-intent -> 200 when it starts a payment, 503 when it refuses
 *
 * Complete means all THREE keys. The secret and publishable keys are what it takes to START a payment; the
 * webhook secret is what it takes to RECORD one. Paying without it would take money that is never booked, so
 * neither entry point accepts a partial set. Every one of the 8 combinations is checked on both paths, for a
 * hosted company (keys stored with the company) and a self-hosted one (keys in the deployment environment).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { HonoConfig } from '../../../server/types/hono';
import { STRIPE_KEYS } from '../../../server/lib/integrations/stripe-keys';

const { createDepositPaymentIntent } = vi.hoisted(() => ({ createDepositPaymentIntent: vi.fn() }));
vi.mock('../../../server/services/stripe.service', () => ({
    StripeService: class {
        constructor(_k: string) { void _k; }
        createDepositPaymentIntent = createDepositPaymentIntent;
    },
}));
vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
vi.mock('../../../server/lib/rate-limit', () => ({ checkRateLimit: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../../server/lib/secrets-cache', () => ({ loadTenantSecrets: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { loadTenantSecrets } from '../../../server/lib/secrets-cache';
// eslint-disable-next-line import/order
import { bookingsRoutes } from '../../../server/api/bookings';
// eslint-disable-next-line import/order
import depositIntentRoutes from '../../../server/api/public/deposit-intent';

const TENANT = 'aaaaaaaa-0000-0000-0000-0000000000c3';
const SLUG = 'acme-agree';
const INSPECTION = 'insp-0000-0000-0000-000000000c03';
const VALUES: Record<(typeof STRIPE_KEYS)[number], string> = {
    STRIPE_PUBLISHABLE_KEY: 'pk_test_1', STRIPE_SECRET_KEY: 'sk_test_1', STRIPE_WEBHOOK_SECRET: 'whsec_1',
};

/** All 8 subsets of the three keys, as [label, keys present]. */
const COMBINATIONS: Array<[string, Partial<typeof VALUES>]> = Array.from({ length: 8 }, (_, mask) => {
    const present = STRIPE_KEYS.filter((_k, i) => mask & (1 << i));
    const label = present.length === 0 ? 'no keys' : present.map((k) => k.replace('STRIPE_', '')).join(' + ');
    return [label, Object.fromEntries(present.map((k) => [k, VALUES[k]]))] as [string, Partial<typeof VALUES>];
});

describe('GET /book/{tenant} and POST deposit-intent agree on complete Stripe keys', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];
    const load = loadTenantSecrets as unknown as ReturnType<typeof vi.fn>;

    function app(selfHosted: boolean) {
        const a = new OpenAPIHono<HonoConfig>();
        a.use('*', async (c, next) => {
            c.set('services', { booking: { getQualifiedInspectorIds: vi.fn().mockResolvedValue([]) } } as unknown as HonoConfig['Variables']['services']);
            c.set('profile', { envCredentialsAreCompanyOwn: selfHosted } as unknown as HonoConfig['Variables']['profile']);
            c.set('resolvedTenantId', TENANT as never);
            c.set('tenantId', TENANT);
            await next();
        });
        a.route('/', bookingsRoutes);
        a.route('/api/public', depositIntentRoutes);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
        return a;
    }

    /**
     * Where the keys live. Hosted: stored with the company, and the secrets middleware merges them into the
     * deployment env of a request that has its tenant (the deposit route's). Self-hosted: only in the env.
     */
    function setup(selfHosted: boolean, keys: Partial<typeof VALUES>) {
        load.mockResolvedValue(selfHosted ? null : { ...keys });
        const base = { DB: {}, JWT_SECRET: 'x'.repeat(32) };
        return {
            profileEnv: (selfHosted ? { ...base, ...keys } : base) as unknown as HonoConfig['Bindings'],
            routeEnv: { ...base, ...keys } as unknown as HonoConfig['Bindings'],
        };
    }

    async function pageOffersPayment(a: OpenAPIHono<HonoConfig>, env: HonoConfig['Bindings']) {
        const res = await a.request(`/book/${SLUG}`, {}, env);
        expect(res.status).toBe(200);
        return ((await res.json()) as { data: { paymentsAvailable: boolean } }).data.paymentsAvailable;
    }

    async function routeStartsPayment(a: OpenAPIHono<HonoConfig>, env: HonoConfig['Bindings']) {
        const res = await a.request(`/api/public/inspections/${INSPECTION}/deposit-intent`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
        }, env);
        expect([200, 503]).toContain(res.status);
        return res.status === 200;
    }

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db as BetterSQLite3Database<typeof schema>;
        sqlite = fixture.sqlite;
        await setupSchema(sqlite);
        await db.insert(schema.tenants).values({
            id: TENANT, slug: SLUG, tier: 'free', status: 'active', maxUsers: 5, deploymentMode: 'shared', createdAt: new Date(),
        } as never);
        await db.insert(schema.tenantConfigs).values({ tenantId: TENANT, companyName: 'Acme', updatedAt: new Date() } as never);
        await db.insert(schema.inspections).values({
            id: INSPECTION, tenantId: TENANT, propertyAddress: '1 Oak St', date: '2026-07-17',
            status: 'requested', createdAt: new Date(), depositRequiredCents: 9000,
        });
        load.mockReset();
        createDepositPaymentIntent.mockReset();
        createDepositPaymentIntent.mockResolvedValue({ id: 'pi_1', clientSecret: 'pi_1_secret' });
    });

    afterEach(() => {
        sqlite.close();
    });

    describe.each([['hosted (keys stored with the company)', false], ['self-hosted (keys in the environment)', true]])('%s', (_name, selfHosted) => {
        it.each(COMBINATIONS)('%s: the page and the route give the same answer, and only the full set passes', async (_label, keys) => {
            const { profileEnv, routeEnv } = setup(selfHosted, keys);
            const a = app(selfHosted);

            const offered = await pageOffersPayment(a, profileEnv);
            const started = await routeStartsPayment(a, routeEnv);

            expect(started).toBe(offered);
            expect(offered).toBe(Object.keys(keys).length === STRIPE_KEYS.length);
            expect(createDepositPaymentIntent).toHaveBeenCalledTimes(started ? 1 : 0);
        });
    });
});
