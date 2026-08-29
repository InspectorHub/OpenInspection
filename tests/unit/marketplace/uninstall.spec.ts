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

    it('an uninstalled entry stops reading as installed in the catalogue listing', async () => {
        // The marker survives an un-import on purpose -- it records which version
        // this workspace was on. A listing that asks only "is there a marker"
        // therefore reports every pack the workspace ever had as installed, and
        // did: it showed the imported version, and could offer to UPDATE a pack
        // the workspace no longer has, while the Install button that brings it
        // back was the one control not on offer.
        await svc.importCatalogEntry('stat-1', 'u1');
        const installed = await svc.list();
        expect(installed.rows.find(r => r.id === 'stat-1')?.importedSemver).toBe('1.0.0');

        await svc.uninstall('stat-1', 'u1');

        const after = await svc.list();
        const row = after.rows.find(r => r.id === 'stat-1');
        expect(row?.importedSemver).toBeNull();
        expect(row?.hasUpdate).toBe(false);
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

    describe('and installing it again', () => {
        // ⚠️ There was no way back in at all. The import path returned early on
        // ANY existing marker, so an uninstall was permanent -- while the schema
        // promised in prose that "reinstalling instead clears this and runs the
        // update path", and the template picker told inspectors to ask an
        // administrator to reinstall something no administrator could.

        it('clears the marker and offers the same template again', async () => {
            const first = await svc.importCatalogEntry('stat-1', 'u1');
            await svc.uninstall('stat-1', 'u1');

            const again = await svc.importCatalogEntry('stat-1', 'u1');

            // The same local row, because un-installing at this version RETIRED
            // it and destroyed nothing. Reinstating it is that change in reverse;
            // minting a second copy would leave the workspace with two.
            expect(again.localEntityId).toBe(first.localEntityId);
            const tpl = await testDb.select().from(schema.templates)
                .where(eq(schema.templates.id, first.localEntityId!)).get();
            expect(tpl!.retiredAt).toBeNull();

            const [marker] = await testDb.select().from(tenantLibraryImports).all();
            expect(marker!.uninstalledAt).toBeNull();
            expect(marker!.localEntityId).toBe(first.localEntityId);
        });

        it('lands on the current version when the catalogue moved on, retiring the old row', async () => {
            // The one case where a reinstall is NOT a visibility change in
            // reverse: putting back the version the workspace left on would
            // deliberately return a superseded statutory revision to the picker,
            // which is the trap `retired_at` exists to close.
            const first = await svc.importCatalogEntry('stat-1', 'u1');
            await svc.uninstall('stat-1', 'u1');
            await testDb.update(marketplaceLibraries)
                .set({ semver: '2.0.0' })
                .where(eq(marketplaceLibraries.id, 'stat-1'));

            const again = await svc.importCatalogEntry('stat-1', 'u1');

            expect(again.localEntityId).not.toBe(first.localEntityId);
            const old = await testDb.select().from(schema.templates)
                .where(eq(schema.templates.id, first.localEntityId!)).get();
            expect(old!.retiredAt).not.toBeNull();
            const fresh = await testDb.select().from(schema.templates)
                .where(eq(schema.templates.id, again.localEntityId!)).get();
            expect(fresh!.retiredAt).toBeNull();

            const [marker] = await testDb.select().from(tenantLibraryImports).all();
            expect(marker!.importedSemver).toBe('2.0.0');
            expect(marker!.uninstalledAt).toBeNull();
        });

        it('puts a comment pack\'s rows back, because its un-import deleted them', async () => {
            // The 1:N half undoes differently, so it is reinstated differently.
            // One branch pretending both kinds come back the same way is the
            // failure the catalogue table's own comment warns about.
            await svc.importCatalogEntry('cmt-1', 'u1');
            const seeded = (await testDb.select().from(schema.comments).all()).length;
            await svc.uninstall('cmt-1', 'u1');
            expect(await testDb.select().from(schema.comments).all()).toHaveLength(0);

            const again = await svc.importCatalogEntry('cmt-1', 'u1');

            expect(again.rowCount).toBe(seeded);
            expect(await testDb.select().from(schema.comments).all()).toHaveLength(seeded);
            const [marker] = await testDb.select().from(tenantLibraryImports).all();
            expect(marker!.uninstalledAt).toBeNull();
            expect(marker!.rowCount).toBe(seeded);
        });

        it('is recorded as an install that says what it came back from', async () => {
            await svc.importCatalogEntry('stat-1', 'u1');
            await svc.uninstall('stat-1', 'u1');
            await svc.importCatalogEntry('stat-1', 'u1');

            const rows = await testDb.select().from(schema.tenantMarketplaceImportHistory).all();
            const reinstall = rows.filter(r => r.action === 'install').at(-1);
            // An install has nothing to move from; a reinstall does, and a reader
            // asking what happened across the absence needs both ends of it.
            expect(reinstall!.sourceVersion).toBe('1.0.0');
            expect(reinstall!.targetVersion).toBe('1.0.0');
        });

        it('refuses to UPDATE an uninstalled entry — installing is the way back', async () => {
            await svc.importCatalogEntry('stat-1', 'u1');
            await svc.uninstall('stat-1', 'u1');
            await testDb.update(marketplaceLibraries)
                .set({ semver: '2.0.0' })
                .where(eq(marketplaceLibraries.id, 'stat-1'));

            // Updating would mint a live local template while every other
            // surface still read the marker as uninstalled.
            await expect(svc.updateTemplateImport('stat-1', 'u1')).rejects.toThrow(/uninstalled/i);
        });

        it('POSITIVE CONTROL — an ordinary second install of a LIVE entry still changes nothing', async () => {
            // The idempotent path this reinstall branch sits beside. If it had
            // swallowed that case, a double-click on Install would now mint a
            // second template or re-insert a pack's rows twice.
            const first = await svc.importCatalogEntry('cmt-1', 'u1');
            const rows = (await testDb.select().from(schema.comments).all()).length;

            const second = await svc.importCatalogEntry('cmt-1', 'u1');

            expect(second).toEqual(first);
            expect(await testDb.select().from(schema.comments).all()).toHaveLength(rows);
        });
    });
});
