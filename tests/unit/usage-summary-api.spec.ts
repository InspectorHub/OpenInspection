/**
 * Free-tier usage quotas Task 6 — `GET /api/usage/summary` payload shape.
 * Pins the extended contract: `{ tier, caps, usage: {...} }` where `caps` is
 * populated only for a free tenant on a profile with `hasUsageQuota` (SaaS),
 * and null otherwise (pro/enterprise tenants, and standalone deploys where
 * the cap can never apply even to a `tier=free` row).
 *
 * In-process Hono harness (mirrors sms-api.spec.ts / plan-quota.spec.ts):
 * mock drizzle-orm/d1 -> in-memory sqlite, mount usageRoutes, drive app.request().
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { createTestDb, setupSchema, toRawD1 } from './db';
import * as schema from '../../server/lib/db/schema';
import { tenants, users } from '../../server/lib/db/schema';
import type { HonoConfig } from '../../server/types/hono';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { AppError } from '../../server/lib/errors';
import { SAAS_PROFILE, STANDALONE_PROFILE } from '../../server/lib/deployment-profile';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

// Imported AFTER the mock is registered.
// eslint-disable-next-line import/order
import usageRoutes from '../../server/api/usage';
import { MeteringService } from '../../server/services/metering.service';

const TENANT = 't-usage-1';

function buildApp(db: BetterSQLite3Database<typeof schema>, profile: typeof SAAS_PROFILE | typeof STANDALONE_PROFILE, tenantId: string | null = TENANT) {
    const app = new OpenAPIHono<HonoConfig>();
    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message, details: err.details } }, err.status);
        }
        return c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500);
    });
    app.use('*', async (c, next) => {
        if (tenantId) c.set('tenantId', tenantId);
        c.set('profile', profile);
        await next();
    });
    app.route('/api/usage', usageRoutes);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    return app;
}

function makeExecCtx() {
    return { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
}

describe('GET /api/usage/summary', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sqlite: any;
    let testD1: D1Database;

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        sqlite = fixture.sqlite;
        await setupSchema(sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        testD1 = toRawD1(sqlite);
    });

    async function seedTenant(id: string, opts: { tier: 'free' | 'pro' | 'enterprise'; maxUsers?: number }) {
        await testDb.insert(tenants).values({
            id, name: `Tenant ${id}`, slug: id, tier: opts.tier,
            maxUsers: opts.maxUsers ?? 5, createdAt: new Date(),
        });
    }

    async function seedUser(tenantId: string, id: string) {
        await testDb.insert(users).values({
            id, tenantId, email: `${id}@example.test`, passwordHash: 'x', createdAt: new Date(),
        });
    }

    it('populates caps for a free tenant on a hasUsageQuota profile, with lifetime totals per metric', async () => {
        await seedTenant(TENANT, { tier: 'free', maxUsers: 5 });
        await seedUser(TENANT, 'u1');
        await seedUser(TENANT, 'u2');
        const m = new MeteringService(testD1);
        await m.record(TENANT, 'inspections', 'lifetime', 3);
        await m.record(TENANT, 'sms', '2026-06', 10);
        await m.record(TENANT, 'email', '2026-06', 20);
        await m.record(TENANT, 'sms_byo', '2026-06', 500);
        await m.record(TENANT, 'email_byo', '2026-06', 250);
        await m.record(TENANT, 'r2_bytes', 'lifetime', 4096);

        const app = buildApp(testDb, SAAS_PROFILE);
        const env = { DB: testD1 } as unknown as HonoConfig['Bindings'];
        const res = await app.request('/api/usage/summary', {}, env, makeExecCtx());
        expect(res.status).toBe(200);
        const body = await res.json() as { data: unknown };
        expect(body.data).toEqual({
            tier: 'free',
            caps: { inspections: 5, sms: 50, email: 50 },
            usage: {
                inspections: 3, sms: 10, email: 20,
                smsByo: 500, emailByo: 250,
                seatsUsed: 2, seatsMax: 5,
                r2Bytes: 4096,
            },
        });
    });

    it('caps is null for a pro tenant even on a hasUsageQuota profile', async () => {
        await seedTenant(TENANT, { tier: 'pro' });
        const app = buildApp(testDb, SAAS_PROFILE);
        const env = { DB: testD1 } as unknown as HonoConfig['Bindings'];
        const res = await app.request('/api/usage/summary', {}, env, makeExecCtx());
        const body = await res.json() as { data: { tier: string; caps: unknown } };
        expect(body.data.tier).toBe('pro');
        expect(body.data.caps).toBeNull();
    });

    it('caps is null in standalone (hasUsageQuota=false) even for a tier=free row', async () => {
        await seedTenant(TENANT, { tier: 'free' });
        const app = buildApp(testDb, STANDALONE_PROFILE);
        const env = { DB: testD1 } as unknown as HonoConfig['Bindings'];
        const res = await app.request('/api/usage/summary', {}, env, makeExecCtx());
        const body = await res.json() as { data: { tier: string; caps: unknown } };
        expect(body.data.tier).toBe('free');
        expect(body.data.caps).toBeNull();
    });

    it('401s when no tenant is resolved', async () => {
        const app = buildApp(testDb, SAAS_PROFILE, null);
        const env = { DB: testD1 } as unknown as HonoConfig['Bindings'];
        const res = await app.request('/api/usage/summary', {}, env, makeExecCtx());
        expect(res.status).toBe(401);
    });

    it('zero-fills every metric for a tenant with no usage rows yet', async () => {
        await seedTenant(TENANT, { tier: 'free' });
        const app = buildApp(testDb, SAAS_PROFILE);
        const env = { DB: testD1 } as unknown as HonoConfig['Bindings'];
        const res = await app.request('/api/usage/summary', {}, env, makeExecCtx());
        const body = await res.json() as { data: { usage: Record<string, number | null> } };
        expect(body.data.usage).toEqual({
            inspections: 0, sms: 0, email: 0, smsByo: 0, emailByo: 0,
            seatsUsed: 0, seatsMax: 5, r2Bytes: 0,
        });
    });
});
