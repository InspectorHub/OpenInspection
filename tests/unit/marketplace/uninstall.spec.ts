import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { MarketplaceService } from '../../../server/services/marketplace.service';
import { marketplaceLibraries, tenantLibraryImports } from '../../../server/lib/db/schema/marketplace';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema, toRawD1 } from '../db';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-000000000001';

const statutoryDoc = {
    schemaVersion: 2,
    sections: [],
    statutoryForm: { formId: 'tx_trec_rei', bindings: {} },
};
const commentsPack = { comments: [{ text: 'Roof looks fine' }, { text: 'Panel is modern' }] };

describe('un-installing a catalogue entry', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];
    let svc: MarketplaceService;

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db; sqlite = fix.sqlite;
        await setupSchema(sqlite);
        await testDb.insert(schema.tenants).values([
            { id: TENANT, slug: 't', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        ]);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        svc = new MarketplaceService(toRawD1(sqlite), TENANT);

        const now = new Date();
        await testDb.insert(marketplaceLibraries).values([
            {
                id: 'stat-1', name: 'TREC REI', kind: 'statutory', semver: '1.0.0',
                schema: JSON.stringify(statutoryDoc), authorId: 'system', changelog: null,
                downloadCount: 0, featured: false, createdAt: now, updatedAt: now,
                propertyType: null, jurisdiction: 'TX', inspectionKind: null,
            },
            {
                id: 'cmt-1', name: 'Starter Comments', kind: 'comments', semver: '1.0.0',
                schema: JSON.stringify(commentsPack), authorId: 'system', changelog: null,
                downloadCount: 0, featured: false, createdAt: now, updatedAt: now,
                propertyType: null, jurisdiction: null, inspectionKind: null,
            },
        ] as (typeof marketplaceLibraries.$inferInsert)[]);
    });

    afterEach(() => { sqlite.close(); vi.clearAllMocks(); });

    it('a statutory uninstall stops new inspections and leaves old ones producible', async () => {
        const installed = await svc.importCatalogEntry('stat-1', 'u1');
        // An inspection carries its OWN snapshot, which is where the declaration
        // is read from -- so this is what has to survive the uninstall.
        await testDb.insert(schema.inspections).values({
            id: 'i1', tenantId: TENANT, propertyAddress: '1 Main St', date: '2025-03-01',
            templateId: installed.localEntityId, templateSnapshot: statutoryDoc,
            createdAt: new Date(),
        } as typeof schema.inspections.$inferInsert);

        const result = await svc.uninstall('stat-1', 'u1');
        expect(result.kind).toBe('statutory');
        expect(result.rowsAffected).toBe(1);

        // The import row is KEPT -- it records which version this workspace was
        // on, and re-issuing needs it.
        const imports = await testDb.select().from(tenantLibraryImports).all();
        expect(imports).toHaveLength(1);
        expect(imports[0]!.uninstalledAt).not.toBeNull();

        // The local template is out of the picker, and still there.
        const tpl = await testDb.select().from(schema.templates)
            .where(eq(schema.templates.id, installed.localEntityId!)).get();
        expect(tpl!.retiredAt).not.toBeNull();

        // The inspection's declaration is untouched: it lives on the snapshot.
        const insp = await testDb.select().from(schema.inspections)
            .where(eq(schema.inspections.id, 'i1')).get();
        const snap = insp!.templateSnapshot as { statutoryForm?: unknown };
        expect(snap.statutoryForm).toBeDefined();
    });

    it('deletes nothing', async () => {
        await svc.importCatalogEntry('stat-1', 'u1');
        const before = await testDb.select().from(schema.templates).all();
        await svc.uninstall('stat-1', 'u1');
        const after = await testDb.select().from(schema.templates).all();
        // Not a soft assertion: the legacy foreign key forbids deleting a
        // referenced template, and the PDF bytes live under a shared _platform/
        // key that other tenants read.
        expect(after).toHaveLength(before.length);
    });

    it('a comments uninstall removes the tagged rows it created', async () => {
        // The 1:N half. One branch pretending both kinds undo the same way is
        // the failure the catalogue table's own comment warns about.
        await svc.importCatalogEntry('cmt-1', 'u1');
        const seeded = await testDb.select().from(schema.comments).all();
        expect(seeded.length).toBeGreaterThan(0);

        const result = await svc.uninstall('cmt-1', 'u1');
        expect(result.kind).toBe('comments');
        expect(result.rowsAffected).toBe(seeded.length);

        const left = await testDb.select().from(schema.comments).all();
        expect(left).toHaveLength(0);
    });

    it('leaves a comment the workspace wrote itself, and another pack\'s rows, alone', async () => {
        // The positive control for the 1:N branch: an un-import that deleted
        // every comment row would satisfy the assertion above just as well.
        await svc.importCatalogEntry('cmt-1', 'u1');
        await testDb.insert(schema.comments).values([
            { id: 'own-1', tenantId: TENANT, text: 'Written here', libraryId: null, createdAt: new Date() },
            { id: 'other-1', tenantId: TENANT, text: 'Another pack', libraryId: 'cmt-other', createdAt: new Date() },
        ] as (typeof schema.comments.$inferInsert)[]);

        await svc.uninstall('cmt-1', 'u1');

        const left = await testDb.select().from(schema.comments).all();
        expect(left.map(r => r.id).sort()).toEqual(['other-1', 'own-1']);
    });

    it('refuses a second uninstall rather than writing a second history row', async () => {
        await svc.importCatalogEntry('stat-1', 'u1');
        await svc.uninstall('stat-1', 'u1');
        await expect(svc.uninstall('stat-1', 'u1')).rejects.toThrow(/already uninstalled/i);
    });

    it('refuses to uninstall something that was never installed', async () => {
        await expect(svc.uninstall('stat-1', 'u1')).rejects.toThrow(/not installed/i);
    });

    it('records the un-import in history, distinctly from an update', async () => {
        await svc.importCatalogEntry('cmt-1', 'u1');
        await svc.uninstall('cmt-1', 'u1');
        const rows = await testDb.select().from(schema.tenantMarketplaceImportHistory).all();
        const actions = rows.map(r => r.action);
        expect(actions).toContain('uninstall');
        // A reader asking "when did this workspace stop using that pack" must be
        // able to find it, rather than infer it from a missing target version.
        const un = rows.find(r => r.action === 'uninstall');
        expect(un!.sourceVersion).toBe('1.0.0');
        expect(un!.targetVersion).toBeNull();
    });
});
