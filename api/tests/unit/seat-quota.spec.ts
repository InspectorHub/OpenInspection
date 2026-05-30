import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb, setupSchema } from './db';
import { tenants, users } from '../../src/lib/db/schema';
import { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../src/lib/db/schema';

// Mock the drizzle-orm/d1 module so the helper's `drizzle(d1)` call returns
// our in-memory SQLite-backed Drizzle instance instead of a real D1 client.
vi.mock('drizzle-orm/d1', () => ({
    drizzle: vi.fn(),
}));

// Mock the usage module so the middleware's getSeatUsage import is
// replaced with a vi.fn() controllable per-test. Hoisted by vitest before
// the middleware module evaluates, so it sees the stub.
vi.mock('../../src/features/seat-quota/usage', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/features/seat-quota/usage')>();
    return {
        ...actual,
        getSeatUsage: vi.fn(actual.getSeatUsage),
    };
});

import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { getSeatUsage } from '../../src/features/seat-quota/usage';
import { Hono } from 'hono';
import { requireSeatAvailable } from '../../src/features/seat-quota';
import { STANDALONE_PROFILE, SAAS_PROFILE, type DeploymentProfile } from '../../src/lib/deployment-profile';
import { AppError } from '../../src/lib/errors';
import type { HonoConfig } from '../../src/types/hono';

describe('getSeatUsage', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let sqlite: any;

    beforeEach(async () => {
        const setup = createTestDb();
        testDb = setup.db;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);
        (mockDrizzle as any).mockReturnValue(testDb);
    });

    async function seedTenant(id: string, maxUsers: number) {
        await testDb.insert(tenants).values({
            id,
            name: `Tenant ${id}`,
            subdomain: id,
            maxUsers,
            createdAt: new Date(),
        });
    }

    async function seedUsers(tenantId: string, count: number) {
        for (let i = 0; i < count; i++) {
            await testDb.insert(users).values({
                id: `${tenantId}-u${i}`,
                tenantId,
                email: `${tenantId}-u${i}@example.com`,
                passwordHash: 'x',
                role: 'inspector',
                createdAt: new Date(),
            });
        }
    }

    it('returns {used, max, remaining} with positive remaining', async () => {
        await seedTenant('t1', 10);
        await seedUsers('t1', 3);

        const usage = await getSeatUsage('t1', {} as any);
        expect(usage).toEqual({ used: 3, max: 10, remaining: 7 });
    });

    it('returns remaining = 0 when at limit', async () => {
        await seedTenant('t1', 5);
        await seedUsers('t1', 5);

        const usage = await getSeatUsage('t1', {} as any);
        expect(usage.used).toBe(5);
        expect(usage.max).toBe(5);
        expect(usage.remaining).toBe(0);
    });

    it('returns remaining = 0 (not negative) when over limit', async () => {
        await seedTenant('t1', 3);
        await seedUsers('t1', 5);

        const usage = await getSeatUsage('t1', {} as any);
        expect(usage.used).toBe(5);
        expect(usage.max).toBe(3);
        expect(usage.remaining).toBe(0);
    });

    it('returns remaining = Infinity when maxUsers is 0 (unlimited sentinel)', async () => {
        // The schema column is NOT NULL with default 3, so unlimited is
        // expressed as 0 in DB. The helper treats 0/null as unlimited.
        await seedTenant('t1', 0);
        await seedUsers('t1', 3);

        const usage = await getSeatUsage('t1', {} as any);
        expect(usage.used).toBe(3);
        expect(usage.max).toBe(null);
        expect(usage.remaining).toBe(Number.POSITIVE_INFINITY);
    });

    it('scopes user count to the tenant', async () => {
        await seedTenant('t1', 10);
        await seedTenant('t2', 10);
        await seedUsers('t1', 2);
        await seedUsers('t2', 4);

        const usage = await getSeatUsage('t1', {} as any);
        expect(usage.used).toBe(2);
        expect(usage.remaining).toBe(8);
    });
});

describe('requireSeatAvailable middleware', () => {
    function makeApp(
        profile: DeploymentProfile = STANDALONE_PROFILE,
        tenantId: string | null = 'tenant-1',
    ) {
        const app = new Hono<HonoConfig>();
        // Mirror the global error handler from src/index.ts so the
        // AppError thrown by the middleware translates to a JSON 4xx.
        app.onError((err, c) => {
            if (err instanceof AppError) {
                return c.json(
                    { success: false, error: { code: err.code, message: err.message, details: err.details } },
                    err.status,
                );
            }
            return c.json({ success: false, error: { code: 'internal_error', message: 'boom' } }, 500);
        });
        app.use('*', async (c, next) => {
            c.set('profile', profile);
            if (tenantId) c.set('tenantId', tenantId);
            await next();
        });
        app.use('*', requireSeatAvailable);
        app.post('/invite', (c) => c.json({ ok: true }));
        return app;
    }

    beforeEach(() => {
        // Ensure each test starts with a clean mock — no leftover
        // mockResolvedValueOnce from a prior case.
        vi.mocked(getSeatUsage).mockReset();
    });

    it('short-circuits to next() when profile.hasSeatQuota is false', async () => {
        // STANDALONE_PROFILE.hasSeatQuota === false, so no DB call needed.
        const app = makeApp(STANDALONE_PROFILE);
        const res = await app.request('/invite', { method: 'POST' }, { DB: {} } as never);
        expect(res.status).toBe(200);
        expect(vi.mocked(getSeatUsage)).not.toHaveBeenCalled();
    });

    it('passes through when seats remain (saas)', async () => {
        // Section F rewrite. SAAS_PROFILE now has hasSeatQuota=true
        // uniformly (no shared/silo split); the middleware calls
        // getSeatUsage and lets the request through when remaining > 0.
        vi.mocked(getSeatUsage).mockResolvedValueOnce({ used: 3, max: 10, remaining: 7 });
        const app = makeApp(SAAS_PROFILE, 'tenant-1');
        const res = await app.request('/invite', { method: 'POST' }, { DB: {} } as never);
        expect(res.status).toBe(200);
        expect(vi.mocked(getSeatUsage)).toHaveBeenCalledWith('tenant-1', expect.anything());
    });

    it('rejects with 402 SEAT_LIMIT_REACHED when at limit (saas)', async () => {
        // Section F rewrite. Confirms the failure path: remaining=0 throws
        // Errors.SeatLimitReached which the global error handler translates
        // to HTTP 402 with the seat-limit error code.
        vi.mocked(getSeatUsage).mockResolvedValueOnce({ used: 10, max: 10, remaining: 0 });
        const app = makeApp(SAAS_PROFILE, 'tenant-1');
        const res = await app.request('/invite', { method: 'POST' }, { DB: {} } as never);
        expect(res.status).toBe(402);
        const body = await res.json() as { success: boolean; error: { code: string; details: unknown } };
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('seat_limit_reached');
        // Payload carries used/max/billingPortalUrl per middleware contract.
        expect(body.error.details).toMatchObject({ used: 10, max: 10 });
    });
});
