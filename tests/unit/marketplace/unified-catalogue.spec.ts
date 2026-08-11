import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { MarketplaceService } from '../../../server/services/marketplace.service';
import { createTestDb, setupSchema, toRawD1 } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { marketplaceLibraries, tenantLibraryImports } from '../../../server/lib/db/schema/marketplace';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-000000000001';

function v2Schema(label: string) {
    return JSON.stringify({
        schemaVersion: 2,
        sections: [{
            id: 'sec1', title: label, items: [{
                id: 'i1', label: 'Item 1', type: 'rich' as const,
                ratingOptions: ['Inspected', 'Not Inspected', 'Not Present', 'Repair', 'Safety Hazard'],
                tabs: { information: [], limitations: [], defects: [] },
            }],
        }],
    });
}

describe('unified catalogue — one table, one import path', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];
    let svc: MarketplaceService;

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db; sqlite = fix.sqlite;
        await setupSchema(sqlite);
        await testDb.insert(schema.tenants).values([
            { id: TENANT, name: 'T', slug: 't', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        ]);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        // `insertLibraryComments` goes through this.rawDb.prepare(...) rather than
        // Drizzle, so the raw D1 shim is the constructor's first argument.
        svc = new MarketplaceService(toRawD1(sqlite), TENANT);
    });

    afterEach(() => { sqlite.close(); vi.clearAllMocks(); });

    async function seedEntry(over: Partial<typeof marketplaceLibraries.$inferInsert> & { id: string }) {
        const now = new Date();
        await testDb.insert(marketplaceLibraries).values({
            name: 'Entry', kind: 'templates', semver: '1.0.0', schema: v2Schema('S'),
            authorId: 'system', changelog: null, downloadCount: 0, featured: false,
            createdAt: now, updatedAt: now,
            propertyType: null, jurisdiction: null, inspectionKind: null,
            ...over,
        } as typeof marketplaceLibraries.$inferInsert);
    }

    it('returns both kinds from one query', async () => {
        await seedEntry({ id: 'tpl-1', name: 'TREC Residential', kind: 'templates' });
        await seedEntry({
            id: 'cmt-1', name: 'Starter Comments', kind: 'comments',
            schema: JSON.stringify({ comments: [{ text: 'a' }, { text: 'b' }] }),
        });

        const res = await svc.list({});

        expect(res.total).toBe(2);
        expect(res.rows.map(r => r.kind).sort()).toEqual(['comments', 'templates']);
        // The comments entry reports its item count from the same call — the
        // Comments tab used to render "empty" because nothing queried this table.
        expect(res.rows.find(r => r.id === 'cmt-1')?.itemCount).toBe(2);
    });

    it('filters on property type, jurisdiction and inspection kind independently', async () => {
        await seedEntry({ id: 'a', name: 'Commercial', propertyType: 'commercial' });
        await seedEntry({ id: 'b', name: 'TREC', propertyType: 'single-family', jurisdiction: 'trec' });
        await seedEntry({ id: 'c', name: 'Pre-Drywall', propertyType: 'single-family', inspectionKind: 'new_construction' });

        const byProperty = await svc.list({ propertyType: 'commercial' });
        expect(byProperty.total).toBe(1);
        expect(byProperty.rows[0]!.id).toBe('a');

        const byJurisdiction = await svc.list({ jurisdiction: 'trec' });
        expect(byJurisdiction.total).toBe(1);
        expect(byJurisdiction.rows[0]!.id).toBe('b');

        const byInspectionKind = await svc.list({ inspectionKind: 'new_construction' });
        expect(byInspectionKind.total).toBe(1);
        expect(byInspectionKind.rows[0]!.id).toBe('c');
    });

    it('a templates import creates one local row and records its id, with row_count 0', async () => {
        await seedEntry({ id: 'tpl-1', name: 'Standard Residential' });

        const result = await svc.importCatalogEntry('tpl-1');

        expect(result.kind).toBe('templates');
        expect(result.rowCount).toBe(0);
        expect(result.localEntityId).toBeTruthy();

        const locals = await testDb.select().from(schema.templates).all();
        expect(locals).toHaveLength(1);
        expect(locals[0]!.id).toBe(result.localEntityId);

        const [marker] = await testDb.select().from(tenantLibraryImports)
            .where(eq(tenantLibraryImports.libraryId, 'tpl-1')).all();
        expect(marker!.localEntityId).toBe(result.localEntityId);
        expect(marker!.rowCount).toBe(0);
    });

    it('a comments import inserts N tagged rows, records the count and leaves local_entity_id null', async () => {
        await seedEntry({
            id: 'cmt-1', name: 'Starter Comments', kind: 'comments',
            schema: JSON.stringify({ comments: [
                { text: 'Roof looks fine', section: 'roof' },
                { text: 'Panel is modern', section: 'electrical' },
                { text: 'No notes' },
            ] }),
        });

        const result = await svc.importCatalogEntry('cmt-1');

        expect(result.kind).toBe('comments');
        expect(result.rowCount).toBe(3);
        expect(result.localEntityId).toBeNull();

        const rows = await testDb.select().from(schema.comments)
            .where(eq(schema.comments.libraryId, 'cmt-1')).all();
        expect(rows).toHaveLength(3);

        const [marker] = await testDb.select().from(tenantLibraryImports)
            .where(eq(tenantLibraryImports.libraryId, 'cmt-1')).all();
        expect(marker!.rowCount).toBe(3);
        expect(marker!.localEntityId).toBeNull();
    });

    // The idempotent branch used to return the import MARKER row's own id, which
    // is not a handle on anything a caller can use. Assert the local content id
    // round-trips and that bug cannot come back.
    it('re-importing a templates entry returns the same local entity id', async () => {
        await seedEntry({ id: 'tpl-1', name: 'Standard Residential' });

        const first = await svc.importCatalogEntry('tpl-1');
        const second = await svc.importCatalogEntry('tpl-1');

        expect(second.localEntityId).toBe(first.localEntityId);
        expect(await testDb.select().from(schema.templates).all()).toHaveLength(1);
    });

    it('refuses a v1 template schema, so it never reaches a tenant', async () => {
        await seedEntry({
            id: 'tpl-v1', name: 'Legacy v1',
            schema: JSON.stringify({
                sections: [{ id: 's', title: 'S', items: [{ id: 'i', label: 'I', type: 'rating' }] }],
            }),
        });

        await expect(svc.importCatalogEntry('tpl-v1')).rejects.toThrow(/v2/i);
        expect(await testDb.select().from(schema.templates).all()).toHaveLength(0);
    });
});
