/**
 * Unit tests for resolveVideoBackend — the 4-way plan/config gating resolver.
 *
 * Strategy: mock drizzle-orm/d1 so the drizzle() call returns a test DB
 * backed by better-sqlite3. Build a minimal Hono-context mock that exposes
 * only the fields resolveVideoBackend reads. Assert the resolved `provider`
 * for each row of the decision table.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

// Import resolver AFTER the mock is wired so it picks up the mock.
import { resolveVideoBackend } from '../../../server/services/video/resolve';
import type { AppEnv } from '../../../server/types/hono';

// ── Test fixtures ─────────────────────────────────────────────────────────────

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

/**
 * Minimal Hono context mock. `resolveVideoBackend` reads:
 *   c.env.APP_MODE, c.env.STREAM, c.env.STREAM_CUSTOMER_SUBDOMAIN,
 *   c.env.PHOTOS, c.env.DB, c.env.JWT_SECRET,
 *   c.env.APP_BASE_URL (via getBaseUrl),
 *   c.req.url, c.req.header (via getBaseUrl fallback),
 *   c.get('tenantId')
 */
function mockCtx(opts: {
    mode: string;
    streamSubdomain?: string;
    hasStream?: boolean;
}) {
    const vars: Record<string, unknown> = {
        tenantId: TENANT_ID,
    };
    const env: Partial<AppEnv> = {
        APP_MODE: opts.mode as AppEnv['APP_MODE'],
        DB: {} as D1Database,
        PHOTOS: {} as R2Bucket,
        JWT_SECRET: 'test-secret-32-chars-xxxxxxxxxxxx',
        APP_BASE_URL: 'https://test.example.com',
    };

    if (opts.hasStream === true) {
        env.STREAM = {} as StreamBinding;
    }

    if (opts.streamSubdomain !== undefined) {
        env.STREAM_CUSTOMER_SUBDOMAIN = opts.streamSubdomain;
    }

    return {
        env,
        get: (key: string) => vars[key],
        req: {
            url: 'https://test.example.com/api/test',
            header: (_name: string) => null,
        },
    } as unknown as import('hono').Context<import('../../../server/types/hono').HonoConfig>;
}

// ── DB setup ──────────────────────────────────────────────────────────────────

let testDb: BetterSQLite3Database<typeof schema>;

beforeEach(async () => {
    const fixture = createTestDb();
    testDb = fixture.db;
    await setupSchema(fixture.sqlite);

    // Wire the drizzle mock so calls inside resolveVideoBackend use testDb.
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
});

// ── Seed helpers ──────────────────────────────────────────────────────────────

async function seedTenant(tier: string, status: string) {
    await testDb.insert(schema.tenants).values({
        id: TENANT_ID,
        name: 'Test Co',
        slug: 'test-co',
        tier: tier as 'free' | 'pro' | 'enterprise',
        status: status as 'pending' | 'active' | 'suspended' | 'trial',
        deploymentMode: 'shared',
        createdAt: new Date(),
    });
}

async function seedStandaloneTenant() {
    await testDb.insert(schema.tenants).values({
        id: TENANT_ID,
        name: 'Self-Host Co',
        slug: 'self-host-co',
        tier: 'free',
        status: 'active',
        deploymentMode: 'shared',
        createdAt: new Date(),
    });
}

async function seedTenantConfig(videoMode: string, extraJson?: Record<string, unknown>) {
    const existing = await testDb
        .select({ id: schema.tenants.id })
        .from(schema.tenants)
        .where(eq(schema.tenants.id, TENANT_ID))
        .get();
    if (!existing) {
        await seedStandaloneTenant();
    }

    const integrationConfig = extraJson ? JSON.stringify(extraJson) : null;
    await testDb.insert(schema.tenantConfigs).values({
        tenantId: TENANT_ID,
        videoMode: videoMode as 'r2' | 'stream',
        integrationConfig,
        updatedAt: new Date(),
    }).onConflictDoUpdate({
        target: schema.tenantConfigs.tenantId,
        set: {
            videoMode: videoMode as 'r2' | 'stream',
            integrationConfig,
            updatedAt: new Date(),
        },
    });
}

// ── 4-way table tests ─────────────────────────────────────────────────────────
//
// Table rows (per the task brief):
//   1. SaaS / free / active          → r2
//   2. SaaS / pro  / active (paid)   → stream
//   3. SaaS / pro  / trial (paid=no) → r2
//   4. Standalone / videoMode=r2     → r2
//   5. Standalone / videoMode=stream → stream

describe('resolveVideoBackend — 4-way decision table', () => {
    it('saas / free tenant → provider=r2', async () => {
        await seedTenant('free', 'active');
        const ctx = mockCtx({ mode: 'saas' });
        const { provider } = await resolveVideoBackend(ctx);
        expect(provider).toBe('r2');
    });

    it('saas / pro+active (paid) → provider=stream', async () => {
        await seedTenant('pro', 'active');
        const ctx = mockCtx({
            mode: 'saas',
            hasStream: true,
            streamSubdomain: 'customer-abc123',
        });
        const { provider } = await resolveVideoBackend(ctx);
        expect(provider).toBe('stream');
    });

    it('saas / pro+trial → provider=r2 (trial is not paid)', async () => {
        await seedTenant('pro', 'trial');
        const ctx = mockCtx({ mode: 'saas' });
        const { provider } = await resolveVideoBackend(ctx);
        expect(provider).toBe('r2');
    });

    it('standalone / videoMode=r2 (default) → provider=r2', async () => {
        await seedTenantConfig('r2');
        const ctx = mockCtx({ mode: 'standalone' });
        const { provider } = await resolveVideoBackend(ctx);
        expect(provider).toBe('r2');
    });

    it('standalone / videoMode=stream → provider=stream', async () => {
        await seedTenantConfig('stream', { streamCustomerSubdomain: 'customer-selfhost' });
        const ctx = mockCtx({
            mode: 'standalone',
            hasStream: true,
        });
        const { provider } = await resolveVideoBackend(ctx);
        expect(provider).toBe('stream');
    });

    // Bonus: enterprise+active (same paid predicate)
    it('saas / enterprise+active (paid) → provider=stream', async () => {
        await seedTenant('enterprise', 'active');
        const ctx = mockCtx({
            mode: 'saas',
            hasStream: true,
            streamSubdomain: 'customer-ent',
        });
        const { provider } = await resolveVideoBackend(ctx);
        expect(provider).toBe('stream');
    });
});

// ── Resolved backend type tests ───────────────────────────────────────────────

describe('resolveVideoBackend — backend instance type', () => {
    it('r2 path returns R2VideoBackend', async () => {
        await seedTenant('free', 'active');
        const ctx = mockCtx({ mode: 'saas' });
        const { backend } = await resolveVideoBackend(ctx);
        const { R2VideoBackend } = await import('../../../server/services/video/r2-backend');
        expect(backend).toBeInstanceOf(R2VideoBackend);
    });

    it('stream path returns StreamVideoBackend', async () => {
        await seedTenant('pro', 'active');
        const ctx = mockCtx({
            mode: 'saas',
            hasStream: true,
            streamSubdomain: 'customer-abc123',
        });
        const { backend } = await resolveVideoBackend(ctx);
        const { StreamVideoBackend } = await import('../../../server/services/video/stream-backend');
        expect(backend).toBeInstanceOf(StreamVideoBackend);
    });
});

// ── streamSubdomain propagation tests ────────────────────────────────────────

describe('resolveVideoBackend — streamSubdomain', () => {
    it('returns streamSubdomain from STREAM_CUSTOMER_SUBDOMAIN on saas paid', async () => {
        await seedTenant('pro', 'active');
        const ctx = mockCtx({
            mode: 'saas',
            hasStream: true,
            streamSubdomain: 'customer-xyz',
        });
        const { streamSubdomain } = await resolveVideoBackend(ctx);
        expect(streamSubdomain).toBe('customer-xyz');
    });

    it('returns null streamSubdomain on r2 path', async () => {
        await seedTenant('free', 'active');
        const ctx = mockCtx({ mode: 'saas' });
        const { streamSubdomain } = await resolveVideoBackend(ctx);
        expect(streamSubdomain).toBeNull();
    });

    it('returns streamSubdomain from integrationConfig on standalone stream', async () => {
        await seedTenantConfig('stream', { streamCustomerSubdomain: 'customer-sh' });
        const ctx = mockCtx({
            mode: 'standalone',
            hasStream: true,
        });
        const { streamSubdomain } = await resolveVideoBackend(ctx);
        expect(streamSubdomain).toBe('customer-sh');
    });
});

// ── Fail-closed tests ─────────────────────────────────────────────────────────

describe('resolveVideoBackend — fail closed', () => {
    it('throws ServiceUnavailable when stream selected but STREAM_CUSTOMER_SUBDOMAIN missing (saas paid)', async () => {
        await seedTenant('pro', 'active');
        const ctx = mockCtx({
            mode: 'saas',
            hasStream: true,
            // No streamSubdomain — STREAM_CUSTOMER_SUBDOMAIN absent
        });

        await expect(resolveVideoBackend(ctx)).rejects.toThrow(/not configured/);
    });

    it('throws ServiceUnavailable when stream selected but STREAM binding missing (standalone)', async () => {
        await seedTenantConfig('stream', { streamCustomerSubdomain: 'customer-sh' });
        const ctx = mockCtx({
            mode: 'standalone',
            // hasStream: false by default — STREAM binding absent
        });

        await expect(resolveVideoBackend(ctx)).rejects.toThrow(/not configured/);
    });
});
