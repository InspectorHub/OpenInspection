import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { tenantRouter } from '../../../server/features/tenant-routing';
import type { HonoConfig } from '../../../server/types/hono';
import { SAAS_PROFILE, STANDALONE_PROFILE } from '../../../server/lib/deployment-profile';
import { createTestDb, setupSchema } from '../db';
import { tenants, tenantSlugHistory } from '../../../server/lib/db/schema';

// History resolution is a D1 READ, so unlike the three tests above (whose
// TENANT_CACHE double always hits and never touches `env.DB`) the slug-history
// tests need a real database behind `drizzle(c.env.DB)`.
vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

function makeApp(profile = SAAS_PROFILE) {
    const app = new Hono<HonoConfig>();
    app.use('*', async (c, next) => { c.set('profile', profile); await next(); });
    app.use('*', tenantRouter);
    return app;
}

describe('tenant-routing — path-param resolution', () => {
    it('extracts tenant from /book/:tenant/:slug path', async () => {
        const fakeTenant = { id: 'tenant-uuid', slug: 'acme', tier: 'pro', status: 'active' };
        const env: Partial<HonoConfig['Bindings']> = {
            DB: { } as never,
            TENANT_CACHE: { get: vi.fn().mockResolvedValue(fakeTenant), put: vi.fn() } as never,
        };
        const app = makeApp();
        let capturedTenantId: string | undefined;
        app.get('/book/:tenant/:slug', (c) => { capturedTenantId = c.get('tenantId'); return c.text('ok'); });
        await app.request('/book/acme/jane-doe', { headers: { host: 'app.example.com' } }, env as HonoConfig['Bindings']);
        expect(capturedTenantId).toBe('tenant-uuid');
    });

    it('path-param wins over slug', async () => {
        const aTenant = { id: 'tenant-a', slug: 'acme', tier: 'pro', status: 'active' };
        const bTenant = { id: 'tenant-b', slug: 'bravo', tier: 'pro', status: 'active' };
        const get = vi.fn((key: string) => Promise.resolve(key.endsWith('acme') ? aTenant : bTenant));
        const env: Partial<HonoConfig['Bindings']> = { DB: {} as never, TENANT_CACHE: { get, put: vi.fn() } as never };
        const app = makeApp();
        let capturedTenantId: string | undefined;
        app.get('/book/:tenant/:slug', (c) => { capturedTenantId = c.get('tenantId'); return c.text('ok'); });
        await app.request('/book/acme/jane', { headers: { host: 'bravo.example.com' } }, env as HonoConfig['Bindings']);
        expect(capturedTenantId).toBe('tenant-a');
    });

    it('falls through to fixed tenant in standalone even when /book/<tenant>/<slug> is hit', async () => {
        const env: Partial<HonoConfig['Bindings']> = { DB: {} as never, TENANT_CACHE: { get: vi.fn().mockResolvedValue(null), put: vi.fn() } as never };
        const app = makeApp(STANDALONE_PROFILE);
        let capturedTenantId: string | undefined;
        app.get('/book/:tenant/:slug', (c) => { capturedTenantId = c.get('tenantId'); return c.text('ok'); });
        await app.request('/book/missing-tenant/jane', { headers: { host: 'localhost' } }, env as HonoConfig['Bindings']);
        expect(capturedTenantId).toBe('00000000-0000-0000-0000-000000000000');
    });
});

describe('tenant-routing — resolution through slug history', () => {
    /** A cache that always misses, so the D1 path below is the one under test. */
    const missingCache = () => ({ get: vi.fn().mockResolvedValue(null), put: vi.fn() });

    async function harness() {
        const fix = createTestDb();
        await setupSchema(fix.sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(fix.db);
        const seedTenant = (v: { id: string; slug: string }) =>
            fix.db.insert(tenants).values({
                ...v, name: v.slug, tier: 'pro', status: 'active', createdAt: new Date(),
            } as typeof tenants.$inferInsert);
        const seedHistory = (v: { oldSlug: string; tenantId: string; retiredUntil?: Date }) =>
            fix.db.insert(tenantSlugHistory).values({
                oldSlug: v.oldSlug, tenantId: v.tenantId,
                changedAt: new Date('2026-08-10T00:00:00Z'),
                retiredUntil: v.retiredUntil ?? new Date('2027-08-10T00:00:00Z'),
            } as typeof tenantSlugHistory.$inferInsert);
        const env = { DB: {}, TENANT_CACHE: missingCache() } as never;
        return { fix, seedTenant, seedHistory, env };
    }

    async function resolvedTenantId(
        env: never, path: string, profile = SAAS_PROFILE,
    ): Promise<string | undefined> {
        const app = makeApp(profile);
        let captured: string | undefined;
        app.get('/book/:tenant/:slug', (c) => { captured = c.get('tenantId'); return c.text('ok'); });
        await app.request(path, { headers: { host: 'app.example.com' } }, env);
        return captured;
    }

    // The whole safety property. History must never shadow a real tenant: once
    // someone claims a released slug their live row wins, and the previous
    // owner's old link lands on the new owner — the accepted, documented
    // outcome, not a bug to route around.
    it('a live tenant wins when both a live row and a history row exist', async () => {
        const h = await harness();
        await h.seedTenant({ id: 'new-owner', slug: 'acme' });
        // `old-owner` must EXIST, under its new slug. Without this row the
        // history branch resolves nothing and the test passes no matter which
        // order the two lookups run in — it would measure nothing.
        await h.seedTenant({ id: 'old-owner', slug: 'renamed-to' });
        await h.seedHistory({ oldSlug: 'acme', tenantId: 'old-owner' });
        expect(await resolvedTenantId(h.env, '/book/acme/x')).toBe('new-owner');
    });

    // The live row for `old-owner` sits under a DIFFERENT slug on purpose: the
    // history lookup resolves a tenant ID and then loads that tenant, so a
    // history row pointing at a nonexistent tenant must not resolve. Drop the
    // seedTenant and the test passes for the wrong reason.
    it('resolves through history when no live tenant holds the slug', async () => {
        const h = await harness();
        await h.seedTenant({ id: 'old-owner', slug: 'renamed-to' });
        await h.seedHistory({ oldSlug: 'gone', tenantId: 'old-owner' });
        expect(await resolvedTenantId(h.env, '/book/gone/x')).toBe('old-owner');
    });

    // Resolution is NOT bounded by the retirement window. Past the window an
    // unclaimed slug still resolving beats 404ing it, and once claimed the first
    // test governs.
    it('resolves through history even past retiredUntil', async () => {
        const h = await harness();
        await h.seedTenant({ id: 'old-owner', slug: 'renamed-to' });
        await h.seedHistory({ oldSlug: 'gone', tenantId: 'old-owner',
                              retiredUntil: new Date('2020-01-01T00:00:00Z') });
        expect(await resolvedTenantId(h.env, '/book/gone/x')).toBe('old-owner');
    });

    it('does not resolve a slug in neither table', async () => {
        const h = await harness();
        expect(await resolvedTenantId(h.env, '/book/nobody/x')).toBeUndefined();
    });

    // Standalone never writes this table, and its fixed-tenant fallthrough
    // already resolves any slug in the URL, so the read must not fire at all on
    // the hottest unauthenticated path in the product.
    it('does not consult history in standalone — the fixed tenant answers', async () => {
        const h = await harness();
        await h.seedTenant({ id: 'old-owner', slug: 'renamed-to' });
        await h.seedHistory({ oldSlug: 'gone', tenantId: 'old-owner' });
        expect(await resolvedTenantId(h.env, '/book/gone/x', STANDALONE_PROFILE))
            .toBe('00000000-0000-0000-0000-000000000000');
    });
});
