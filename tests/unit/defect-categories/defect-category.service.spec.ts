import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DefectCategoryService } from '../../../server/services/inspection/defect-category.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const T1 = '00000000-0000-0000-0000-000000000001';
const T2 = '00000000-0000-0000-0000-000000000002';

describe('DefectCategoryService', () => {
    let svc: DefectCategoryService;
    let testDb: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const f = createTestDb(); testDb = f.db; await setupSchema(f.sqlite);
        await testDb.insert(schema.tenants).values([
            { id: T1, name: 'A', slug: 'a', status: 'active', deploymentMode: 'shared', tier: 'free', maxUsers: 5, appliedCmdSeq: 0, appliedCredSeq: 0, createdAt: new Date() },
            { id: T2, name: 'B', slug: 'b', status: 'active', deploymentMode: 'shared', tier: 'free', maxUsers: 5, appliedCmdSeq: 0, appliedCredSeq: 0, createdAt: new Date() },
        ]);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        svc = new DefectCategoryService({} as D1Database);
    });

    it('ensureSeed inserts exactly 3 canonical categories once', async () => {
        await svc.ensureSeed(T1);
        await svc.ensureSeed(T1); // idempotent
        const rows = await svc.list(T1);
        expect(rows).toHaveLength(3);
        expect(rows.map((r) => r.name).sort()).toEqual(['maintenance', 'recommendation', 'safety']);
        expect(rows.find((r) => r.name === 'safety')!.drivesSummary).toBe(true);
        expect(rows.find((r) => r.name === 'maintenance')!.drivesSummary).toBe(false);
        expect(rows.every((r) => r.isSeed)).toBe(true);
    });

    it('scopes by tenant', async () => {
        await svc.create(T1, { name: 'custom', color: '#123456', drivesSummary: false });
        expect(await svc.list(T2)).toHaveLength(0);
    });

    it('create + update + remove round-trip a custom (non-seed) category', async () => {
        const row = await svc.create(T1, { name: 'custom', color: '#123456', drivesSummary: false });
        expect(row.isSeed).toBe(false);

        await svc.update(T1, row.id, { name: 'custom-renamed', sortOrder: 5 });
        const afterUpdate = await svc.list(T1);
        expect(afterUpdate.find((r) => r.id === row.id)!.name).toBe('custom-renamed');

        await svc.remove(T1, row.id);
        expect(await svc.list(T1)).toHaveLength(0);
    });

    it('remove refuses to delete a seed row', async () => {
        await svc.ensureSeed(T1);
        const rows = await svc.list(T1);
        const safety = rows.find((r) => r.name === 'safety')!;

        await svc.remove(T1, safety.id);

        const after = await svc.list(T1);
        expect(after.find((r) => r.id === safety.id)).toBeDefined();
        expect(after).toHaveLength(3);
    });

    it('list orders by sortOrder ascending', async () => {
        await svc.ensureSeed(T1);
        const rows = await svc.list(T1);
        expect(rows.map((r) => r.name)).toEqual(['maintenance', 'recommendation', 'safety']);
    });
});
