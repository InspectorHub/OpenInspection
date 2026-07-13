import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq, and, isNull } from 'drizzle-orm';
import { MarketplaceService } from '../../../server/services/marketplace.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { marketplaceLibraries, tenantLibraryImports, tenantMarketplaceImportHistory } from '../../../server/lib/db/schema/marketplace';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-000000000001';
const USER = 'user-1';

function buildRawDb(testDb: BetterSQLite3Database<typeof schema>) {
    // Pulls the underlying better-sqlite3 client from drizzle so we can
    // surface a D1-style fluent prepare().bind().run() shim that the
    // chunked-INSERT codepath depends on.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = (testDb as any).$client
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ?? ((testDb as any).session?.client)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ?? ((testDb as any)._.session?.client);
    return {
        prepare(sqlStr: string) {
            return {
                bind(...params: unknown[]) {
                    return {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        run: () => (raw as any).prepare(sqlStr).run(...params),
                    };
                },
            };
        },
    };
}

describe('MarketplaceService.updateLibraryImport — replace mode (S2-7)', () => {
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
        svc = new MarketplaceService(buildRawDb(testDb) as any, TENANT);
    });

    async function seedLibrary(opts: { semver: string; entries: Array<{ text: string; section?: string }> }) {
        const libraryId = crypto.randomUUID();
        const now = new Date();
        await testDb.insert(marketplaceLibraries).values({
            id:            libraryId,
            name:          'Test Library',
            kind:          'comments',
            semver:        opts.semver,
            schema:        JSON.stringify({ comments: opts.entries }),
            authorId:      'system',
            changelog:     null,
            downloadCount: 0,
            featured:      false,
            createdAt:     now,
            updatedAt:     now,
        });
        return libraryId;
    }

    it('replace mode deletes all rows from prior import then inserts new pack', async () => {
        const libraryId = await seedLibrary({
            semver: '2.0.0',
            entries: [
                { text: 'New A', section: 'Roof' },
                { text: 'New B', section: 'Plumbing' },
            ],
        });

        // Seed prior-import comments tied to the library.
        for (let i = 0; i < 3; i++) {
            await testDb.insert(schema.comments).values({
                id: crypto.randomUUID(),
                tenantId: TENANT,
                text: 'Old comment ' + i,
                category: 'Roof',
                libraryId,
                createdAt: new Date(),
            });
        }

        // Tenant-authored comment (no libraryId) — must NOT be touched.
        const tenantOwnId = crypto.randomUUID();
        await testDb.insert(schema.comments).values({
            id: tenantOwnId,
            tenantId: TENANT,
            text: 'Tenant own comment',
            category: 'Custom',
            libraryId: null,
            createdAt: new Date(),
        });

        // Seed the import marker so updateLibraryImport recognises it.
        await testDb.insert(tenantLibraryImports).values({
            id:             crypto.randomUUID(),
            tenantId:       TENANT,
            libraryId,
            importedSemver: '1.0.0',
            importedAt:     new Date(),
            rowCount:       3,
        });

        const result = await svc.updateLibraryImport(libraryId, {
            mode: 'replace',
            confirmLossOfEdits: true,
            userId: USER,
        });

        expect(result.mode).toBe('replace');
        expect(result.fromSemver).toBe('1.0.0');
        expect(result.toSemver).toBe('2.0.0');
        expect(result.rowsAdded).toBe(2);
        expect(result.rowsDeleted).toBe(3);

        // Tenant-authored comment is untouched.
        const tenantOwn = await testDb.select().from(schema.comments)
            .where(eq(schema.comments.id, tenantOwnId)).get();
        expect(tenantOwn).toBeTruthy();
        expect(tenantOwn!.text).toBe('Tenant own comment');

        // The 3 prior rows are gone, replaced by 2 new ones.
        const importedRows = await testDb.select().from(schema.comments)
            .where(eq(schema.comments.libraryId, libraryId)).all();
        expect(importedRows).toHaveLength(2);
        expect(importedRows.map((r) => r.text).sort()).toEqual(['New A', 'New B']);

        // Import marker rowCount reflects the final count (not accumulated).
        const importMarker = await testDb.select().from(tenantLibraryImports)
            .where(eq(tenantLibraryImports.libraryId, libraryId)).get();
        expect(importMarker!.rowCount).toBe(2);
        expect(importMarker!.importedSemver).toBe('2.0.0');
    });

    it('append mode adds rows alongside existing ones (legacy behavior preserved)', async () => {
        const libraryId = await seedLibrary({
            semver: '1.1.0',
            entries: [
                { text: 'Brand new entry' },
            ],
        });
        await testDb.insert(schema.comments).values({
            id: crypto.randomUUID(), tenantId: TENANT,
            text: 'Existing imported entry',
            category: null,
            libraryId,
            createdAt: new Date(),
        });
        await testDb.insert(tenantLibraryImports).values({
            id:             crypto.randomUUID(),
            tenantId:       TENANT,
            libraryId,
            importedSemver: '1.0.0',
            importedAt:     new Date(),
            rowCount:       1,
        });

        const result = await svc.updateLibraryImport(libraryId, {
            mode: 'append',
            userId: USER,
        });
        expect(result.mode).toBe('append');
        expect(result.rowsDeleted).toBe(0);
        expect(result.rowsAdded).toBe(1);

        const rows = await testDb.select().from(schema.comments)
            .where(eq(schema.comments.libraryId, libraryId)).all();
        expect(rows).toHaveLength(2);
    });

    it('replace mode without confirmLossOfEdits flag is allowed when no user-modified rows exist', async () => {
        const libraryId = await seedLibrary({ semver: '2.0.0', entries: [{ text: 'X' }] });
        await testDb.insert(tenantLibraryImports).values({
            id:             crypto.randomUUID(),
            tenantId:       TENANT,
            libraryId,
            importedSemver: '1.0.0',
            importedAt:     new Date(),
            rowCount:       0,
        });
        const result = await svc.updateLibraryImport(libraryId, {
            mode: 'replace',
            confirmLossOfEdits: false,
            userId: USER,
        });
        expect(result.mode).toBe('replace');
    });

    it('replace mode writes a history row with action=replace', async () => {
        const libraryId = await seedLibrary({ semver: '2.0.0', entries: [{ text: 'X' }] });
        await testDb.insert(tenantLibraryImports).values({
            id:             crypto.randomUUID(),
            tenantId:       TENANT,
            libraryId,
            importedSemver: '1.0.0',
            importedAt:     new Date(),
            rowCount:       0,
        });
        await svc.updateLibraryImport(libraryId, { mode: 'replace', userId: USER });

        const history = await testDb.select().from(tenantMarketplaceImportHistory)
            .where(and(
                eq(tenantMarketplaceImportHistory.tenantId, TENANT),
                eq(tenantMarketplaceImportHistory.libraryId, libraryId),
            )).all();
        expect(history).toHaveLength(1);
        expect(history[0].action).toBe('replace');
        expect(history[0].sourceVersion).toBe('1.0.0');
        expect(history[0].targetVersion).toBe('2.0.0');
        expect(history[0].createdBy).toBe(USER);
    });

    it('append mode also writes a history row with action=update', async () => {
        const libraryId = await seedLibrary({ semver: '1.1.0', entries: [{ text: 'X' }] });
        await testDb.insert(tenantLibraryImports).values({
            id:             crypto.randomUUID(),
            tenantId:       TENANT,
            libraryId,
            importedSemver: '1.0.0',
            importedAt:     new Date(),
            rowCount:       0,
        });
        await svc.updateLibraryImport(libraryId, { mode: 'append', userId: USER });

        const history = await testDb.select().from(tenantMarketplaceImportHistory)
            .where(and(
                eq(tenantMarketplaceImportHistory.tenantId, TENANT),
                eq(tenantMarketplaceImportHistory.libraryId, libraryId),
            )).all();
        expect(history).toHaveLength(1);
        expect(history[0].action).toBe('update');
    });

    it('does not delete other tenants comments under replace', async () => {
        const otherTenant = '00000000-0000-0000-0000-000000000002';
        await testDb.insert(schema.tenants).values({
            id: otherTenant, name: 'O', slug: 'o',
            status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        const libraryId = await seedLibrary({ semver: '2.0.0', entries: [{ text: 'X' }] });
        await testDb.insert(schema.comments).values({
            id: crypto.randomUUID(), tenantId: otherTenant,
            text: 'Other tenant own', category: null, libraryId,
            createdAt: new Date(),
        });
        await testDb.insert(tenantLibraryImports).values({
            id:             crypto.randomUUID(),
            tenantId:       TENANT,
            libraryId,
            importedSemver: '1.0.0',
            importedAt:     new Date(),
            rowCount:       0,
        });

        await svc.updateLibraryImport(libraryId, { mode: 'replace', userId: USER });

        const surviving = await testDb.select().from(schema.comments)
            .where(eq(schema.comments.tenantId, otherTenant)).all();
        expect(surviving).toHaveLength(1);
    });

    // Ensures the existing import-marker row count reflects the new state.
    it('replace mode resets rowCount to the new import size', async () => {
        const libraryId = await seedLibrary({
            semver: '2.0.0',
            entries: [{ text: 'one' }, { text: 'two' }, { text: 'three' }],
        });
        await testDb.insert(tenantLibraryImports).values({
            id:             crypto.randomUUID(),
            tenantId:       TENANT,
            libraryId,
            importedSemver: '1.0.0',
            importedAt:     new Date(),
            rowCount:       50,
        });
        await svc.updateLibraryImport(libraryId, { mode: 'replace', userId: USER });
        const m = await testDb.select().from(tenantLibraryImports)
            .where(eq(tenantLibraryImports.libraryId, libraryId)).get();
        expect(m!.rowCount).toBe(3);
    });

    // Sanity: tenant-authored comments (libraryId null) are never deleted.
    it('replace never deletes comments with NULL libraryId', async () => {
        const libraryId = await seedLibrary({ semver: '2.0.0', entries: [{ text: 'X' }] });
        await testDb.insert(schema.comments).values({
            id: crypto.randomUUID(), tenantId: TENANT,
            text: 'Local snippet', category: null, libraryId: null,
            createdAt: new Date(),
        });
        await testDb.insert(tenantLibraryImports).values({
            id: crypto.randomUUID(), tenantId: TENANT,
            libraryId, importedSemver: '1.0.0',
            importedAt: new Date(), rowCount: 0,
        });
        await svc.updateLibraryImport(libraryId, { mode: 'replace', userId: USER });
        const local = await testDb.select().from(schema.comments)
            .where(and(eq(schema.comments.tenantId, TENANT), isNull(schema.comments.libraryId))).all();
        expect(local).toHaveLength(1);
    });
});
