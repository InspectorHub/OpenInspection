import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { marketplaceLibraries, tenantLibraryImports } from '../../../server/lib/db/schema/marketplace';
import { createTestDb, setupSchema } from '../db';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

describe('unified marketplace catalogue shape', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db; sqlite = fix.sqlite;
        await setupSchema(sqlite);
    });
    afterEach(() => { sqlite.close(); });

    it('a templates-kind row carries the three browse axes', async () => {
        const now = new Date();
        await db.insert(marketplaceLibraries).values({
            id: 'lib-t', name: 'TREC Residential', kind: 'templates', semver: '1.0.0',
            schema: '{}', authorId: 'system', changelog: null, downloadCount: 0,
            featured: false, createdAt: now, updatedAt: now,
            propertyType: 'single-family', jurisdiction: 'trec', inspectionKind: null,
        } as typeof marketplaceLibraries.$inferInsert);
        const [row] = await db.select().from(marketplaceLibraries).all();
        expect(row.kind).toBe('templates');
        expect(row.propertyType).toBe('single-family');
        expect(row.jurisdiction).toBe('trec');
        expect(row.inspectionKind).toBeNull();
    });

    // The whole point of the nullable local_entity_id: a 1:1 kind is tracked by
    // an id and a 1:N kind by a count, and one table has to hold both without
    // pretending they are the same operation.
    it('an import marker holds an entity id OR a row count, per kind', async () => {
        const now = new Date();
        await db.insert(tenantLibraryImports).values([
            { id: 'i1', tenantId: 't1', libraryId: 'lib-t', importedSemver: '1.0.0',
              importedAt: now, rowCount: 0, localEntityId: 'local-template-uuid' },
            { id: 'i2', tenantId: 't1', libraryId: 'lib-c', importedSemver: '1.0.0',
              importedAt: now, rowCount: 248, localEntityId: null },
        ] as (typeof tenantLibraryImports.$inferInsert)[]);
        const rows = await db.select().from(tenantLibraryImports).all();
        expect(rows.find(r => r.id === 'i1')?.localEntityId).toBe('local-template-uuid');
        expect(rows.find(r => r.id === 'i2')?.rowCount).toBe(248);
    });
});
