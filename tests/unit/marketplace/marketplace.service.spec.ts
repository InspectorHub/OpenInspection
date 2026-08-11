import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { MarketplaceService } from '../../../server/services/marketplace.service';
import { createTestDb, setupSchema, toRawD1 } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { marketplaceLibraries, tenantLibraryImports } from '../../../server/lib/db/schema/marketplace';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-000000000001';

describe('MarketplaceService — import + update against the unified catalogue', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];
    let svc: MarketplaceService;

    beforeEach(async () => {
        const setup = createTestDb();
        testDb = setup.db;
        sqlite = setup.sqlite;
        await setupSchema(setup.sqlite);
        await testDb.insert(schema.tenants).values([
            { id: TENANT, name: 'T', slug: 't', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        ]);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        // The comment-pack path runs raw SQL through rawDb.prepare(...).bind(...).run(),
        // so the raw D1 adapter is the constructor's first argument.
        svc = new MarketplaceService(toRawD1(setup.sqlite), TENANT);
    });

    it('Spec 5B P3 — rejects v1 catalogue templates with a clear error', async () => {
        // v1 shape: no schemaVersion, items use type:"rating" — must fail validation.
        const v1Schema = JSON.stringify({
            sections: [{ id: 's', title: 'S', items: [{ id: 'i', label: 'I', type: 'rating' }] }],
        });
        const catalogId = crypto.randomUUID();
        const now = new Date();
        await testDb.insert(marketplaceLibraries).values({
            id:            catalogId,
            name:          'Legacy v1 Template',
            kind:          'templates',
            semver:        '0.9.0',
            schema:        v1Schema,
            authorId:      'system',
            changelog:     'legacy',
            downloadCount: 0,
            featured:      false,
            createdAt:     now,
            updatedAt:     now,
            propertyType:  'single-family',
            jurisdiction:  null,
            inspectionKind: null,
        });

        await expect(svc.importCatalogEntry(catalogId)).rejects.toThrow(/v2/i);

        // Confirm no row leaked into the tenant's templates table.
        const rows = await testDb.select().from(schema.templates).all();
        expect(rows.length).toBe(0);
    });

    // "Update available" flow (Scheme 2): keep the old local template, create a
    // NEW local row at the new semver, re-point the import marker.

    function v2Schema(label: string) {
        const richItem = (id: string, l: string) => ({
            id, label: l, type: 'rich' as const,
            ratingOptions: ['Inspected', 'Not Inspected', 'Not Present', 'Repair', 'Safety Hazard'],
            tabs: { information: [], limitations: [], defects: [] },
        });
        return JSON.stringify({
            schemaVersion: 2,
            sections: [{ id: 'sec1', title: label, items: [richItem('i1', 'Item 1')] }],
        });
    }

    async function seedImportedTemplate(opts: { mktSemver: string; importedSemver: string }) {
        const catalogId = crypto.randomUUID();
        const oldLocalId = crypto.randomUUID();
        const now = new Date();

        await testDb.insert(marketplaceLibraries).values({
            id:            catalogId,
            name:          'Standard Residential',
            kind:          'templates',
            semver:        opts.mktSemver,
            schema:        v2Schema('Section A'),
            authorId:      'system',
            changelog:     'updated',
            downloadCount: 5,
            featured:      false,
            createdAt:     now,
            updatedAt:     now,
            propertyType:  'single-family',
            jurisdiction:  null,
            inspectionKind: null,
        });
        await testDb.insert(schema.templates).values({
            id:        oldLocalId,
            tenantId:  TENANT,
            name:      'Standard Residential',
            schema:    v2Schema('Section A'),
            createdAt: new Date(),
        });
        await testDb.insert(tenantLibraryImports).values({
            id:             crypto.randomUUID(),
            tenantId:       TENANT,
            libraryId:      catalogId,
            importedSemver: opts.importedSemver,
            importedAt:     now,
            rowCount:       0,
            localEntityId:  oldLocalId,
        });
        return { catalogId, oldLocalId };
    }

    it('updateTemplateImport: creates new local copy + repoints import + preserves old row', async () => {
        const { catalogId, oldLocalId } = await seedImportedTemplate({
            mktSemver: '1.1.0',
            importedSemver: '1.0.0',
        });

        const result = await svc.updateTemplateImport(catalogId);

        expect(result.fromSemver).toBe('1.0.0');
        expect(result.toSemver).toBe('1.1.0');
        expect(result.oldLocalId).toBe(oldLocalId);
        expect(result.newLocalId).not.toBe(oldLocalId);
        expect(result.newName).toBe('Standard Residential (v1.1.0)');

        // Old local row preserved (zero data loss for any inspection that references it)
        const oldRow = await testDb.select().from(schema.templates).where(eq(schema.templates.id, oldLocalId)).get();
        expect(oldRow).toBeTruthy();
        expect(oldRow!.name).toBe('Standard Residential');

        // New local row exists with the suffixed name
        const newRow = await testDb.select().from(schema.templates).where(eq(schema.templates.id, result.newLocalId)).get();
        expect(newRow).toBeTruthy();
        expect(newRow!.name).toBe('Standard Residential (v1.1.0)');

        // Import marker repointed to the new local id + new semver
        const imports = await testDb.select().from(tenantLibraryImports)
            .where(eq(tenantLibraryImports.libraryId, catalogId)).all();
        expect(imports.length).toBe(1);
        expect(imports[0]!.localEntityId).toBe(result.newLocalId);
        expect(imports[0]!.importedSemver).toBe('1.1.0');
    });

    it('updateTemplateImport: rejects when no update is available (semvers match)', async () => {
        const { catalogId } = await seedImportedTemplate({
            mktSemver: '1.0.0',
            importedSemver: '1.0.0',
        });
        await expect(svc.updateTemplateImport(catalogId)).rejects.toThrow(/No update available/i);
    });

    it('updateTemplateImport: rejects when no prior import exists', async () => {
        const catalogId = crypto.randomUUID();
        const now = new Date();
        await testDb.insert(marketplaceLibraries).values({
            id:            catalogId,
            name:          'Brand New Template',
            kind:          'templates',
            semver:        '1.0.0',
            schema:        v2Schema('S'),
            authorId:      'system',
            changelog:     null,
            downloadCount: 0,
            featured:      false,
            createdAt:     now,
            updatedAt:     now,
            propertyType:  null,
            jurisdiction:  null,
            inspectionKind: null,
        });
        await expect(svc.updateTemplateImport(catalogId)).rejects.toThrow(/has not been imported/i);
    });

    it('updateTemplateImport: refuses to update to a v1 schema (v2 gate)', async () => {
        // Seed a tenant that is on a healthy v2 import, then mutate the catalogue
        // row's schema to a legacy v1 shape and bump its semver. The update must
        // refuse rather than leak v1 into the tenant.
        const { catalogId } = await seedImportedTemplate({
            mktSemver: '1.0.0',
            importedSemver: '1.0.0',
        });
        const v1Schema = JSON.stringify({
            sections: [{ id: 's', title: 'S', items: [{ id: 'i', label: 'I', type: 'rating' }] }],
        });
        await testDb.update(marketplaceLibraries)
            .set({ semver: '1.1.0', schema: v1Schema })
            .where(eq(marketplaceLibraries.id, catalogId));

        await expect(svc.updateTemplateImport(catalogId)).rejects.toThrow(/v2/i);
    });

    it('updateTemplateImport: refuses a comments entry rather than building a template from it', async () => {
        const catalogId = crypto.randomUUID();
        const now = new Date();
        await testDb.insert(marketplaceLibraries).values({
            id:            catalogId,
            name:          'Starter Comments',
            kind:          'comments',
            semver:        '1.0.0',
            schema:        JSON.stringify({ comments: [{ text: 'a' }] }),
            authorId:      'system',
            changelog:     null,
            downloadCount: 0,
            featured:      false,
            createdAt:     now,
            updatedAt:     now,
            propertyType:  null,
            jurisdiction:  null,
            inspectionKind: null,
        });
        await expect(svc.updateTemplateImport(catalogId)).rejects.toThrow(/not a template/i);
    });

    it('updateLibraryImport: appends new rows + repoints import marker', async () => {
        const libraryId = crypto.randomUUID();
        const now = new Date();
        await testDb.insert(marketplaceLibraries).values({
            id:            libraryId,
            name:          'Standard Comments',
            kind:          'comments',
            semver:        '1.1.0',
            schema:        JSON.stringify({ comments: [
                { text: 'New comment 1', section: 'roof' },
                { text: 'New comment 2', section: 'plumbing' },
                { text: 'New comment 3' },
            ]}),
            authorId:      'system',
            changelog:     'v1.1',
            downloadCount: 0,
            featured:      false,
            createdAt:     now,
            updatedAt:     now,
            propertyType:  null,
            jurisdiction:  null,
            inspectionKind: null,
        });
        await testDb.insert(tenantLibraryImports).values({
            id:             crypto.randomUUID(),
            tenantId:       TENANT,
            libraryId,
            importedSemver: '1.0.0',
            importedAt:     now,
            rowCount:       10, // pretend the v1 import added 10 rows previously
            localEntityId:  null,
        });

        const result = await svc.updateLibraryImport(libraryId);

        expect(result.fromSemver).toBe('1.0.0');
        expect(result.toSemver).toBe('1.1.0');
        expect(result.rowsAdded).toBe(3);
        expect(result.libraryName).toBe('Standard Comments');

        // Import marker advanced + rowCount accumulated
        const importRow = await testDb.select().from(tenantLibraryImports)
            .where(eq(tenantLibraryImports.libraryId, libraryId)).get();
        expect(importRow!.importedSemver).toBe('1.1.0');
        expect(importRow!.rowCount).toBe(13); // 10 prior + 3 added

        // 3 new comment rows physically exist
        const commentRows = await testDb.select().from(schema.comments)
            .where(eq(schema.comments.tenantId, TENANT)).all();
        expect(commentRows.length).toBe(3);
    });

    it('imports a catalogue template with its sections intact', async () => {
        const richItem = (id: string, label: string) => ({
            id, label, type: 'rich' as const,
            ratingOptions: ['Inspected', 'Not Inspected', 'Not Present', 'Repair', 'Safety Hazard'],
            tabs: { information: [], limitations: [], defects: [] },
        });
        const correctSchema = JSON.stringify({
            schemaVersion: 2,
            sections: [
                { id: 'sec1', title: 'Section 1', items: [richItem('i1', 'Item 1')] },
                { id: 'sec2', title: 'Section 2', items: [richItem('i2', 'Item 2')] },
            ],
        });
        const catalogId = crypto.randomUUID();
        const now = new Date();
        await testDb.insert(marketplaceLibraries).values({
            id:            catalogId,
            name:          'Standard Residential Inspection',
            kind:          'templates',
            semver:        '1.0.0',
            schema:        correctSchema,
            authorId:      'system',
            changelog:     'test',
            downloadCount: 0,
            featured:      false,
            createdAt:     now,
            updatedAt:     now,
            propertyType:  'single-family',
            jurisdiction:  null,
            inspectionKind: null,
        });

        const { localEntityId } = await svc.importCatalogEntry(catalogId);

        const localRow = await testDb
            .select()
            .from(schema.templates)
            .where(eq(schema.templates.id, localEntityId!))
            .get();

        expect(localRow).toBeTruthy();
        // schema column may come back as string or parsed object depending on drizzle mode
        const parsed =
            typeof localRow!.schema === 'string'
                ? JSON.parse(localRow!.schema)
                : localRow!.schema;
        expect(parsed.sections).toBeDefined();
        expect(parsed.sections.length).toBeGreaterThan(0);
        expect(parsed.sections[0].items.length).toBeGreaterThan(0);
    });
});
