import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MarketplaceService } from '../../server/services/marketplace.service';
import { createTestDb, setupSchema } from './db';
import { marketplaceTemplates } from '../../server/lib/db/schema';
import { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../server/lib/db/schema';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

describe('MarketplaceService.list', () => {
    let svc: MarketplaceService;
    let testDb: BetterSQLite3Database<typeof schema>;
    let sqlite: any;

    beforeEach(async () => {
        const s = createTestDb();
        testDb = s.db; sqlite = s.sqlite;
        await setupSchema(sqlite);
        (mockDrizzle as any).mockReturnValue(testDb);
        const now = new Date().toISOString();
        for (let i = 0; i < 13; i++) {
            await testDb.insert(marketplaceTemplates).values({
                id: `mkt-${i}`,
                name: `Template ${i}`,
                category: 'residential',
                semver: '1.0.0',
                schema: '{}',
                authorId: 'system',
                changelog: '',
                downloadCount: i,
                featured: i < 5 ? 1 : 0,
                createdAt: now,
                updatedAt: now,
            });
        }
        svc = new MarketplaceService({} as any, 'tenant-A');
    });

    afterEach(() => { sqlite.close(); vi.clearAllMocks(); });

    it('returns {rows, total} with total=13 and rows<=pageSize', async () => {
        const res = await svc.list({ page: 1, pageSize: 12 });
        expect(res.total).toBe(13);
        expect(res.rows).toHaveLength(12);
    });
    it('page=2 returns the remaining 1 row', async () => {
        const res = await svc.list({ page: 2, pageSize: 12 });
        expect(res.total).toBe(13);
        expect(res.rows).toHaveLength(1);
    });
    it('honors category filter in total count', async () => {
        const res = await svc.list({ page: 1, pageSize: 50, category: 'commercial' });
        expect(res.total).toBe(0);
        expect(res.rows).toHaveLength(0);
    });
});
