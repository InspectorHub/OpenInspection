/**
 * `GET /api/billing/summary` must count the same seats the seat guard counts.
 *
 * The pure aggregator (`summariseSeats`) is covered in billing-summary.spec.ts
 * and cannot see this bug: the route selected the tenant's users with no
 * `deleted_at IS NULL` filter, so a member removed by `TeamService.removeMember`
 * — soft-deleted precisely so `inspections.inspector_id` attribution survives —
 * kept showing up as an occupied seat on the billing page while
 * `getSeatUsage` (the invite guard, the session context, the portal quota sync)
 * had already released it.
 *
 * Two numbers for the same thing, disagreeing, one of them shown to the
 * customer. This spec pins the route's query, which is where the divergence
 * lived.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb, setupSchema } from '../db';
import { tenants, users } from '../../../server/lib/db/schema';
import { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { Hono } from 'hono';
import billingRoutes from '../../../server/api/billing';
import { SAAS_PROFILE, STANDALONE_PROFILE } from '../../../server/lib/deployment-profile';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';

type SummaryBody = {
    success: boolean;
    data: { tier: string; maxUsers: number; seatsUsed: number; permanent: number; guests: number; portalUrl?: string };
};

describe('GET /api/billing/summary', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let sqlite: any;

    beforeEach(async () => {
        const setup = createTestDb();
        testDb = setup.db;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);
        (mockDrizzle as any).mockReturnValue(testDb);
    });

    afterEach(() => {
        sqlite.close();
        vi.clearAllMocks();
    });

    function makeApp(tenantId: string | null = 't1', profile = STANDALONE_PROFILE) {
        const app = new Hono<HonoConfig>();
        app.onError((err, c) => {
            if (err instanceof AppError) {
                return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status);
            }
            return c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500);
        });
        app.use('*', async (c, next) => {
            c.set('profile', profile);
            if (tenantId) c.set('tenantId', tenantId);
            await next();
        });
        app.route('/', billingRoutes);
        return app;
    }

    async function seedTenant(id: string, maxUsers: number, tier: 'free' | 'pro' | 'enterprise' = 'pro') {
        await testDb.insert(tenants).values({ id, slug: id, maxUsers, tier, createdAt: new Date() });
    }

    async function seedMember(tenantId: string, id: string, deleted = false) {
        await testDb.insert(users).values({
            id, tenantId, email: `${id}@example.com`, passwordHash: 'x',
            role: 'inspector', createdAt: new Date(),
            ...(deleted ? { deletedAt: new Date() } : {}),
        });
    }

    async function fetchSummary(app: Hono<HonoConfig>) {
        const res = await app.request('/summary', {}, { DB: {} } as never);
        return { res, body: (await res.json()) as SummaryBody };
    }

    it('excludes soft-deleted members from seatsUsed', async () => {
        await seedTenant('t1', 5);
        await seedMember('t1', 'active-1');
        await seedMember('t1', 'active-2');
        await seedMember('t1', 'removed-1', true);
        await seedMember('t1', 'removed-2', true);

        const { res, body } = await fetchSummary(makeApp());

        expect(res.status).toBe(200);
        // Two active members hold two seats. The two removed rows hold none —
        // `getSeatUsage` already reports 2 for this tenant.
        expect(body.data.seatsUsed).toBe(2);
        expect(body.data.permanent).toBe(2);
        expect(body.data.maxUsers).toBe(5);
    });

    it('reports 0 seats used for a workspace whose members were all removed', async () => {
        await seedTenant('t1', 3);
        await seedMember('t1', 'gone-1', true);
        await seedMember('t1', 'gone-2', true);

        const { body } = await fetchSummary(makeApp());
        expect(body.data.seatsUsed).toBe(0);
    });

    it('positive control — active members ARE counted, so a zero is a real zero', async () => {
        await seedTenant('t1', 3);
        await seedMember('t1', 'active-1');

        const { body } = await fetchSummary(makeApp());
        expect(body.data.seatsUsed).toBe(1);
    });

    it('stays scoped to the requesting tenant', async () => {
        await seedTenant('t1', 5);
        await seedTenant('t2', 5);
        await seedMember('t1', 't1-a');
        await seedMember('t2', 't2-a');
        await seedMember('t2', 't2-b');

        const { body } = await fetchSummary(makeApp('t1'));
        expect(body.data.seatsUsed).toBe(1);
    });

    it('404s for an unknown tenant', async () => {
        const { res } = await fetchSummary(makeApp('nope'));
        expect(res.status).toBe(404);
    });

    it('appends the portal URL only when the deployment has one', async () => {
        await seedTenant('t1', 5);
        await seedMember('t1', 'active-1');

        const standalone = await fetchSummary(makeApp('t1', STANDALONE_PROFILE));
        expect(standalone.body.data.portalUrl).toBeUndefined();

        const saas = await fetchSummary(makeApp('t1', { ...SAAS_PROFILE, billingPortalUrl: 'https://portal.example' }));
        expect(saas.body.data.portalUrl).toBe('https://portal.example/api/billing/portal');
    });
});
