import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RecommendationService } from '../../src/services/recommendation.service';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../src/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT_A = '00000000-0000-0000-0000-000000000001';
const TENANT_B = '00000000-0000-0000-0000-000000000002';
const USER_1   = '00000000-0000-0000-0000-0000000000a1';

async function seedBaseRows(testDb: BetterSQLite3Database<typeof schema>) {
    await testDb.insert(schema.tenants).values([
        { id: TENANT_A, name: 'A', subdomain: 'a', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        { id: TENANT_B, name: 'B', subdomain: 'b', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
    ]);
}

describe('RecommendationService', () => {
    let svc: RecommendationService;
    let testDb: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const setup = createTestDb();
        testDb = setup.db;
        await setupSchema(setup.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        svc = new RecommendationService({} as any);
        await seedBaseRows(testDb);
    });

    it('creates a recommendation and returns it', async () => {
        const r = await svc.create(TENANT_A, {
            category: 'Roof', name: 'Active leak', severity: 'defect',
            defaultEstimateMin: 80000, defaultEstimateMax: 150000,
            defaultRepairSummary: 'Recommend evaluation by licensed roofer.',
            createdByUserId: USER_1,
        });
        expect(r.id).toBeTruthy();
        expect(r.tenantId).toBe(TENANT_A);
        expect(r.severity).toBe('defect');
    });

    it('lists only the calling tenant\'s recommendations', async () => {
        await svc.create(TENANT_A, { category: 'Roof', name: 'A1', severity: 'defect', defaultRepairSummary: 'x' });
        await svc.create(TENANT_B, { category: 'Roof', name: 'B1', severity: 'defect', defaultRepairSummary: 'x' });
        const rows = await svc.listByTenant(TENANT_A);
        expect(rows.map(r => r.name)).toEqual(['A1']);
    });

    it('filters by category and severity', async () => {
        await svc.create(TENANT_A, { category: 'Roof', name: 'A', severity: 'defect',  defaultRepairSummary: 'x' });
        await svc.create(TENANT_A, { category: 'Roof', name: 'B', severity: 'monitor', defaultRepairSummary: 'x' });
        await svc.create(TENANT_A, { category: 'Wall', name: 'C', severity: 'defect',  defaultRepairSummary: 'x' });
        const onlyRoofDefects = await svc.listByTenant(TENANT_A, { category: 'Roof', severity: 'defect' });
        expect(onlyRoofDefects.map(r => r.name)).toEqual(['A']);
    });

    it('updates a recommendation', async () => {
        const r = await svc.create(TENANT_A, { category: 'Roof', name: 'X', severity: 'defect', defaultRepairSummary: 'x' });
        const updated = await svc.update(r.id, TENANT_A, { name: 'X-renamed', defaultRepairSummary: 'y' });
        expect(updated.name).toBe('X-renamed');
        expect(updated.defaultRepairSummary).toBe('y');
    });

    it('refuses cross-tenant update', async () => {
        const r = await svc.create(TENANT_A, { category: 'Roof', name: 'X', severity: 'defect', defaultRepairSummary: 'x' });
        await expect(svc.update(r.id, TENANT_B, { name: 'Y' })).rejects.toThrow();
    });

    it('deletes a recommendation', async () => {
        const r = await svc.create(TENANT_A, { category: 'Roof', name: 'X', severity: 'defect', defaultRepairSummary: 'x' });
        await svc.delete(r.id, TENANT_A);
        const fetched = await svc.getById(r.id, TENANT_A);
        expect(fetched).toBeNull();
    });
});
