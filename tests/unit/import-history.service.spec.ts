import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ImportHistoryService } from '../../src/services/import-history.service';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../src/lib/db/schema';
import { tenantMarketplaceImportHistory } from '../../src/lib/db/schema/marketplace';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTHER_TENANT = '00000000-0000-0000-0000-000000000002';
const USER = 'user-1';

async function insertHistory(testDb: BetterSQLite3Database<typeof schema>, opts: {
    tenantId?: string;
    templateId?: string | null;
    libraryId?: string | null;
    action: 'install' | 'update' | 'replace' | 'migrate';
    createdAt?: number;
    metadata?: Record<string, unknown>;
}) {
    await testDb.insert(tenantMarketplaceImportHistory).values({
        id:            crypto.randomUUID(),
        tenantId:      opts.tenantId ?? TENANT,
        templateId:    opts.templateId ?? null,
        libraryId:     opts.libraryId ?? null,
        action:        opts.action,
        sourceVersion: null,
        targetVersion: '1.0.0',
        rowsAffected:  1,
        metadata:      opts.metadata ? JSON.stringify(opts.metadata) : null,
        createdAt:     opts.createdAt ?? Date.now(),
        createdBy:     USER,
    });
}

describe('ImportHistoryService', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let svc: ImportHistoryService;

    beforeEach(async () => {
        const setup = createTestDb();
        testDb = setup.db;
        await setupSchema(setup.sqlite);
        await testDb.insert(schema.tenants).values([
            { id: TENANT, name: 'T', subdomain: 't', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
            { id: OTHER_TENANT, name: 'O', subdomain: 'o', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        ]);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        svc = new ImportHistoryService({} as any, TENANT);
    });

    it('lists tenant rows ordered by createdAt DESC', async () => {
        await insertHistory(testDb, { templateId: 't1', action: 'install', createdAt: 100 });
        await insertHistory(testDb, { templateId: 't1', action: 'update',  createdAt: 200 });
        await insertHistory(testDb, { templateId: 't1', action: 'migrate', createdAt: 300 });

        const result = await svc.list();
        expect(result.items).toHaveLength(3);
        expect(result.items.map((i) => i.action)).toEqual(['migrate', 'update', 'install']);
    });

    it('filters by templateId', async () => {
        await insertHistory(testDb, { templateId: 'A', action: 'install' });
        await insertHistory(testDb, { templateId: 'B', action: 'install' });
        await insertHistory(testDb, { libraryId: 'L', action: 'install' });

        const result = await svc.list({ templateId: 'A' });
        expect(result.items).toHaveLength(1);
        expect(result.items[0].templateId).toBe('A');
    });

    it('filters by libraryId', async () => {
        await insertHistory(testDb, { templateId: 'A', action: 'install' });
        await insertHistory(testDb, { libraryId: 'lib-1', action: 'install' });
        await insertHistory(testDb, { libraryId: 'lib-1', action: 'replace' });
        await insertHistory(testDb, { libraryId: 'lib-2', action: 'install' });

        const result = await svc.list({ libraryId: 'lib-1' });
        expect(result.items).toHaveLength(2);
        expect(result.items.every((i) => i.libraryId === 'lib-1')).toBe(true);
    });

    it('does not leak rows from other tenants', async () => {
        await insertHistory(testDb, { tenantId: OTHER_TENANT, templateId: 'x', action: 'install' });
        await insertHistory(testDb, { templateId: 'y', action: 'install' });

        const result = await svc.list();
        expect(result.items).toHaveLength(1);
        expect(result.items[0].templateId).toBe('y');
    });

    it('parses metadata JSON', async () => {
        await insertHistory(testDb, {
            templateId: 'A',
            action: 'migrate',
            metadata: { fromTemplateId: 'old', strategy: 'preserve_unknown' },
        });
        const result = await svc.list();
        expect(result.items[0].metadata).toEqual({ fromTemplateId: 'old', strategy: 'preserve_unknown' });
    });

    it('respects pagination (hasMore + page/pageSize)', async () => {
        for (let i = 0; i < 25; i++) {
            await insertHistory(testDb, { templateId: 'A', action: 'install', createdAt: i });
        }
        const page1 = await svc.list({ pageSize: 10, page: 1 });
        expect(page1.items).toHaveLength(10);
        expect(page1.hasMore).toBe(true);

        const page3 = await svc.list({ pageSize: 10, page: 3 });
        expect(page3.items).toHaveLength(5);
        expect(page3.hasMore).toBe(false);
    });
});
