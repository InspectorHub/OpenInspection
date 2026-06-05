/**
 * IA-27 — tenant_configs.siteName initialization on both provisioning paths.
 *
 * Verifies that:
 *  1. When no tenant_configs row exists, one is created with siteName = name.
 *  2. When a row exists with a null/empty siteName, it is filled in.
 *  3. When a row already has a user-chosen siteName, it is never overwritten.
 *  4. When handleTenantUpdate is called without a name param, no config row is written.
 *
 * Runs the REAL implementations (PortalProvider + StandaloneProvider) against
 * in-memory SQLite + real migrations — same pattern as admin.service.spec.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb, setupSchema } from './db';
import { tenants, tenantConfigs } from '../../server/lib/db/schema';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../server/lib/db/schema';

// Both providers use drizzle-orm/d1 internally — redirect to in-memory SQLite.
vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

// Import providers AFTER the mock is set up.
import { PortalProvider } from '../../server/portal/portal.provider';
import { StandaloneProvider } from '../../server/lib/integration/standalone';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const TENANT_SLUG = 'acme-inspections';

let testDb: BetterSQLite3Database<typeof schema>;
let sqlite: any;

async function seedTenant(id = TENANT_ID, slug = TENANT_SLUG) {
    await testDb.insert(tenants).values({
        id,
        name: 'Acme Inspections',
        slug,
        createdAt: new Date(),
    });
}

// ────────────────────────────────────────────────────────────────────────────
// SaaS path — PortalProvider.handleTenantUpdate
// ────────────────────────────────────────────────────────────────────────────
describe('PortalProvider — siteName init (SaaS path)', () => {
    let provider: PortalProvider;

    beforeEach(async () => {
        const setup = createTestDb();
        testDb = setup.db;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);
        (mockDrizzle as any).mockReturnValue(testDb);
        provider = new PortalProvider({} as any);
    });

    afterEach(() => {
        sqlite.close();
        vi.clearAllMocks();
    });

    it('creates a tenant_configs row with siteName when none exists', async () => {
        await provider.handleTenantUpdate({
            id: TENANT_ID,
            slug: TENANT_SLUG,
            name: 'Acme Inspections',
            status: 'active',
        });

        const cfg = await testDb
            .select()
            .from(tenantConfigs)
            .where(eq(tenantConfigs.tenantId, TENANT_ID))
            .get();

        expect(cfg).toBeDefined();
        expect(cfg?.siteName).toBe('Acme Inspections');
    });

    it('fills in siteName when a config row exists with null siteName', async () => {
        // Provision the tenant first, then insert a config row with no siteName.
        await provider.handleTenantUpdate({
            id: TENANT_ID,
            slug: TENANT_SLUG,
            name: 'Acme Inspections',
            status: 'active',
        });
        // Manually clear siteName to simulate a partially-initialized row.
        await testDb
            .update(tenantConfigs)
            .set({ siteName: null })
            .where(eq(tenantConfigs.tenantId, TENANT_ID));

        // Call again — should backfill the null.
        await provider.handleTenantUpdate({
            id: TENANT_ID,
            slug: TENANT_SLUG,
            name: 'Acme Inspections',
            status: 'active',
        });

        const cfg = await testDb
            .select()
            .from(tenantConfigs)
            .where(eq(tenantConfigs.tenantId, TENANT_ID))
            .get();
        expect(cfg?.siteName).toBe('Acme Inspections');
    });

    it('does NOT overwrite an existing siteName (initialize-only)', async () => {
        // Provision with initial name.
        await provider.handleTenantUpdate({
            id: TENANT_ID,
            slug: TENANT_SLUG,
            name: 'Acme Inspections',
            status: 'active',
        });
        // User customises their brand name in Settings.
        await testDb
            .update(tenantConfigs)
            .set({ siteName: 'My Brand' })
            .where(eq(tenantConfigs.tenantId, TENANT_ID));

        // Portal syncs a name update — must not overwrite the user's choice.
        await provider.handleTenantUpdate({
            id: TENANT_ID,
            slug: TENANT_SLUG,
            name: 'New Company Name Ltd',
            status: 'active',
        });

        const cfg = await testDb
            .select()
            .from(tenantConfigs)
            .where(eq(tenantConfigs.tenantId, TENANT_ID))
            .get();
        expect(cfg?.siteName).toBe('My Brand');
    });

    it('writes no tenant_configs row when name is absent', async () => {
        await provider.handleTenantUpdate({
            id: TENANT_ID,
            slug: TENANT_SLUG,
            // name intentionally omitted
            status: 'active',
        });

        const cfg = await testDb
            .select()
            .from(tenantConfigs)
            .where(eq(tenantConfigs.tenantId, TENANT_ID))
            .get();
        expect(cfg).toBeUndefined();
    });
});

// ────────────────────────────────────────────────────────────────────────────
// Standalone path — StandaloneProvider.handleTenantUpdate
// ────────────────────────────────────────────────────────────────────────────
describe('StandaloneProvider — siteName init (standalone path)', () => {
    let provider: StandaloneProvider;

    beforeEach(async () => {
        const setup = createTestDb();
        testDb = setup.db;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);
        (mockDrizzle as any).mockReturnValue(testDb);
        provider = new StandaloneProvider({} as any);
    });

    afterEach(() => {
        sqlite.close();
        vi.clearAllMocks();
    });

    it('creates a tenant_configs row with siteName when none exists', async () => {
        await provider.handleTenantUpdate({
            id: TENANT_ID,
            slug: TENANT_SLUG,
            name: 'Solo Inspections LLC',
            status: 'active',
        });

        const cfg = await testDb
            .select()
            .from(tenantConfigs)
            .where(eq(tenantConfigs.tenantId, TENANT_ID))
            .get();
        expect(cfg).toBeDefined();
        expect(cfg?.siteName).toBe('Solo Inspections LLC');
    });

    it('fills in siteName when a config row exists with null siteName', async () => {
        await provider.handleTenantUpdate({
            id: TENANT_ID,
            slug: TENANT_SLUG,
            name: 'Solo Inspections LLC',
            status: 'active',
        });
        await testDb
            .update(tenantConfigs)
            .set({ siteName: null })
            .where(eq(tenantConfigs.tenantId, TENANT_ID));

        await provider.handleTenantUpdate({
            id: TENANT_ID,
            slug: TENANT_SLUG,
            name: 'Solo Inspections LLC',
            status: 'active',
        });

        const cfg = await testDb
            .select()
            .from(tenantConfigs)
            .where(eq(tenantConfigs.tenantId, TENANT_ID))
            .get();
        expect(cfg?.siteName).toBe('Solo Inspections LLC');
    });

    it('does NOT overwrite an existing siteName (initialize-only)', async () => {
        await provider.handleTenantUpdate({
            id: TENANT_ID,
            slug: TENANT_SLUG,
            name: 'Solo Inspections LLC',
            status: 'active',
        });
        await testDb
            .update(tenantConfigs)
            .set({ siteName: 'My Brand' })
            .where(eq(tenantConfigs.tenantId, TENANT_ID));

        await provider.handleTenantUpdate({
            id: TENANT_ID,
            slug: TENANT_SLUG,
            name: 'New Name',
            status: 'active',
        });

        const cfg = await testDb
            .select()
            .from(tenantConfigs)
            .where(eq(tenantConfigs.tenantId, TENANT_ID))
            .get();
        expect(cfg?.siteName).toBe('My Brand');
    });

    it('writes no tenant_configs row when name is absent', async () => {
        await provider.handleTenantUpdate({
            id: TENANT_ID,
            slug: TENANT_SLUG,
            // name intentionally omitted
            status: 'active',
        });

        const cfg = await testDb
            .select()
            .from(tenantConfigs)
            .where(eq(tenantConfigs.tenantId, TENANT_ID))
            .get();
        expect(cfg).toBeUndefined();
    });
});
