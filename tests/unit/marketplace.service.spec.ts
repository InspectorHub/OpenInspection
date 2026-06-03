import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { MarketplaceService } from '../../server/services/marketplace.service';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../server/lib/db/schema';
import { marketplaceTemplates, tenantMarketplaceImports, marketplaceLibraries, tenantLibraryImports } from '../../server/lib/db/schema/marketplace';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-000000000001';

describe('MarketplaceService.importTemplate (Spec 1 fix verification)', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let svc: MarketplaceService;

    beforeEach(async () => {
        const setup = createTestDb();
        testDb = setup.db;
        await setupSchema(setup.sqlite);
        await testDb.insert(schema.tenants).values([
            { id: TENANT, name: 'T', slug: 't', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        ]);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        svc = new MarketplaceService({} as any, TENANT);
    });

    it('Spec 5B P3 — rejects v1 marketplace templates with a clear error', async () => {
        // v1 shape: no schemaVersion, items use type:"rating" — must fail validation.
        const v1Schema = JSON.stringify({
            sections: [{ id: 's', title: 'S', items: [{ id: 'i', label: 'I', type: 'rating' }] }],
        });
        const marketplaceId = crypto.randomUUID();
        const now = new Date().toISOString();
        await testDb.insert(marketplaceTemplates).values({
            id:            marketplaceId,
            name:          'Legacy v1 Template',
            category:      'residential',
            semver:        '0.9.0',
            schema:        v1Schema,
            authorId:      'system',
            changelog:     'legacy',
            downloadCount: 0,
            createdAt:     now,
            updatedAt:     now,
        });

        await expect(svc.importTemplate(marketplaceId)).rejects.toThrow(/v2/i);

        // Confirm no row leaked into the tenant's templates table.
        const rows = await testDb.select().from(schema.templates).all();
        expect(rows.length).toBe(0);
    });

    // Round 37 — "Update available" flow (Scheme 2): keep the old local
    // template, create a NEW local row at the new semver, re-point the
    // import marker. The following three tests cover happy path + the
    // two reject paths the brief calls out.

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
        const marketplaceId = crypto.randomUUID();
        const oldLocalId = crypto.randomUUID();
        const now = new Date().toISOString();

        await testDb.insert(marketplaceTemplates).values({
            id:            marketplaceId,
            name:          'Standard Residential',
            category:      'residential',
            semver:        opts.mktSemver,
            schema:        v2Schema('Section A'),
            authorId:      'system',
            changelog:     'updated',
            downloadCount: 5,
            createdAt:     now,
            updatedAt:     now,
        });
        await testDb.insert(schema.templates).values({
            id:        oldLocalId,
            tenantId:  TENANT,
            name:      'Standard Residential',
            schema:    v2Schema('Section A'),
            createdAt: new Date(),
        });
        await testDb.insert(tenantMarketplaceImports).values({
            id:                    crypto.randomUUID(),
            tenantId:              TENANT,
            marketplaceTemplateId: marketplaceId,
            importedSemver:        opts.importedSemver,
            localTemplateId:       oldLocalId,
            importedAt:            now,
        });
        return { marketplaceId, oldLocalId };
    }

    it('Round 37 — updateTemplateImport: creates new local copy + repoints import + preserves old row', async () => {
        const { marketplaceId, oldLocalId } = await seedImportedTemplate({
            mktSemver: '1.1.0',
            importedSemver: '1.0.0',
        });

        const result = await svc.updateTemplateImport(marketplaceId);

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
        const imports = await testDb.select().from(tenantMarketplaceImports)
            .where(eq(tenantMarketplaceImports.marketplaceTemplateId, marketplaceId)).all();
        expect(imports.length).toBe(1);
        expect(imports[0].localTemplateId).toBe(result.newLocalId);
        expect(imports[0].importedSemver).toBe('1.1.0');
    });

    it('Round 37 — updateTemplateImport: rejects when no update is available (semvers match)', async () => {
        const { marketplaceId } = await seedImportedTemplate({
            mktSemver: '1.0.0',
            importedSemver: '1.0.0',
        });
        await expect(svc.updateTemplateImport(marketplaceId)).rejects.toThrow(/No update available/i);
    });

    it('Round 37 — updateTemplateImport: rejects when no prior import exists', async () => {
        const marketplaceId = crypto.randomUUID();
        const now = new Date().toISOString();
        await testDb.insert(marketplaceTemplates).values({
            id:            marketplaceId,
            name:          'Brand New Template',
            category:      'residential',
            semver:        '1.0.0',
            schema:        v2Schema('S'),
            authorId:      'system',
            changelog:     null,
            downloadCount: 0,
            createdAt:     now,
            updatedAt:     now,
        });
        await expect(svc.updateTemplateImport(marketplaceId)).rejects.toThrow(/has not been imported/i);
    });

    it('Round 37 — updateTemplateImport: refuses to update to a v1 schema (R36 v2 gate)', async () => {
        // Seed a tenant that is on a healthy v2 import, then mutate the
        // marketplace row's schema to a legacy v1 shape and bump its semver.
        // The update must refuse rather than leak v1 into the tenant.
        const { marketplaceId } = await seedImportedTemplate({
            mktSemver: '1.0.0',
            importedSemver: '1.0.0',
        });
        const v1Schema = JSON.stringify({
            sections: [{ id: 's', title: 'S', items: [{ id: 'i', label: 'I', type: 'rating' }] }],
        });
        await testDb.update(marketplaceTemplates)
            .set({ semver: '1.1.0', schema: v1Schema })
            .where(eq(marketplaceTemplates.id, marketplaceId));

        await expect(svc.updateTemplateImport(marketplaceId)).rejects.toThrow(/v2/i);
    });

    it('Round 37 — updateLibraryImport: appends new rows + repoints import marker', async () => {
        // The library update path runs raw SQL via rawDb.prepare(...).bind(...).run()
        // (chunked INSERT). Wire rawDb to better-sqlite3 with a thin shim so the
        // D1-style fluent .bind().run() works under test.
        const sqliteDb = (testDb as unknown as { $client?: { prepare: (sql: string) => { run: (...p: unknown[]) => unknown } } }).$client
            ?? null;
        // Fallback — fish out the raw better-sqlite3 instance via testDb internals
        // exposed by drizzle's BetterSQLite3Database class.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const raw = sqliteDb ?? ((testDb as any).session?.client) ?? ((testDb as any)._.session?.client);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rawDb: any = {
            prepare(sql: string) {
                return {
                    bind(...params: unknown[]) {
                        return {
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            run: () => (raw as any).prepare(sql).run(...params),
                        };
                    },
                };
            },
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const svcWithRaw = new MarketplaceService(rawDb, TENANT);

        const libraryId = crypto.randomUUID();
        const now = new Date().toISOString();
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
        });
        await testDb.insert(tenantLibraryImports).values({
            id:             crypto.randomUUID(),
            tenantId:       TENANT,
            libraryId,
            importedSemver: '1.0.0',
            importedAt:     now,
            rowCount:       10, // pretend the v1 import added 10 rows previously
        });

        const result = await svcWithRaw.updateLibraryImport(libraryId);

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

    it('imports a marketplace template with its sections intact (post-Spec1 fix)', async () => {
        // Seed marketplace_templates with the CORRECT shape the importer expects:
        // {sections: [...]} at the top level (not nested under a second .schema key).
        // Spec 5B — v2 schema shape: schemaVersion: 2 + rich items with tabs.
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
        const marketplaceId = crypto.randomUUID();
        const now = new Date().toISOString();
        await testDb.insert(marketplaceTemplates).values({
            id:            marketplaceId,
            name:          'Standard Residential Inspection',
            category:      'residential',
            semver:        '1.0.0',
            schema:        correctSchema,
            authorId:      'system',
            changelog:     'test',
            downloadCount: 0,
            createdAt:     now,
            updatedAt:     now,
        });

        const localTemplateId = await svc.importTemplate(marketplaceId);

        const localRow = await testDb
            .select()
            .from(schema.templates)
            .where(eq(schema.templates.id, localTemplateId))
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
