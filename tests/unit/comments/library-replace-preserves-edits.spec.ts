import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { MarketplaceService } from '../../../server/services/marketplace.service';
import { createTestDb, setupSchema, toRawD1 } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { marketplaceLibraries, tenantLibraryImports } from '../../../server/lib/db/schema/marketplace';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-000000000001';
const USER = 'user-1';

/**
 * The comment an inspector rewrote in their own voice. The v1 text is what the
 * publisher shipped; the rewrite is unpaid evening work that goes to a paying
 * client, and it is the thing a re-import must not silently destroy.
 */
const V1_ROOF = 'Roof shows granule loss consistent with age.';
const REWRITTEN_ROOF = 'Roof shows granule loss consistent with age — normal weathering for this climate.';
const V2_ROOF = 'Roof shows granule loss; remaining service life is limited.';
const UNTOUCHED = 'Water heater is beyond its expected service life.';

describe('MarketplaceService.updateLibraryImport — replace must not destroy rewrites', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let svc: MarketplaceService;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];

    beforeEach(async () => {
        const setup = createTestDb();
        testDb = setup.db;
        sqlite = setup.sqlite;
        await setupSchema(setup.sqlite);
        await testDb.insert(schema.tenants).values([
            { id: TENANT, slug: 't', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        ]);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        svc = new MarketplaceService(toRawD1(setup.sqlite), TENANT);
    });

    /** Seed the catalogue at v1 and run the real import path, so rows are written the way production writes them. */
    async function importV1(): Promise<string> {
        const libraryId = crypto.randomUUID();
        const now = new Date();
        await testDb.insert(marketplaceLibraries).values({
            id:            libraryId,
            name:          'Regional Roofing Pack',
            kind:          'comments',
            semver:        '1.0.0',
            schema:        JSON.stringify({ comments: [
                { text: V1_ROOF,  section: 'Roof' },
                { text: UNTOUCHED, section: 'Plumbing' },
            ] }),
            authorId:      'system',
            changelog:     null,
            downloadCount: 0,
            featured:      false,
            createdAt:     now,
            updatedAt:     now,
        });
        await svc.importCatalogEntry(libraryId, USER);
        return libraryId;
    }

    /**
     * The tenant rewrites one imported row. Deliberately a bare `UPDATE ... SET text`,
     * the shape every write path in the app reduces to — no edit flag is set here, so
     * this pins that detection rests on comparing content against what was imported
     * rather than on a caller remembering to stamp a marker.
     */
    function rewriteRow(commentId: string, newText: string): void {
        sqlite.prepare('UPDATE comments SET text = ? WHERE id = ?').run(newText, commentId);
    }

    async function publishV2(libraryId: string): Promise<void> {
        await testDb.update(marketplaceLibraries).set({
            semver: '2.0.0',
            schema: JSON.stringify({ comments: [
                { text: V2_ROOF,   section: 'Roof' },
                { text: UNTOUCHED, section: 'Plumbing' },
            ] }),
            updatedAt: new Date(),
        }).where(eq(marketplaceLibraries.id, libraryId));
    }

    async function roofRowId(libraryId: string): Promise<string> {
        const row = await testDb.select().from(schema.comments)
            .where(and(eq(schema.comments.tenantId, TENANT), eq(schema.comments.text, V1_ROOF))).get();
        expect(row, `the v1 roof comment should have been imported for ${libraryId}`).toBeTruthy();
        return row!.id;
    }

    it('keeps a rewritten comment when the caller has not accepted the loss', async () => {
        const libraryId = await importV1();
        rewriteRow(await roofRowId(libraryId), REWRITTEN_ROOF);
        await publishV2(libraryId);

        await svc.updateLibraryImport(libraryId, { mode: 'replace', userId: USER });

        const texts = (await testDb.select().from(schema.comments)
            .where(eq(schema.comments.tenantId, TENANT)).all()).map(r => r.text);

        // The whole point: the inspector's own words survive a publisher's v2.
        expect(texts).toContain(REWRITTEN_ROOF);
        // The row they never touched is replaced by v2 rather than duplicated.
        expect(texts.filter(t => t === UNTOUCHED)).toHaveLength(1);
        // v2's new roof text still arrives, alongside the rewrite rather than over it.
        expect(texts).toContain(V2_ROOF);
    });

    it('reports the rewrite it preserved', async () => {
        const libraryId = await importV1();
        rewriteRow(await roofRowId(libraryId), REWRITTEN_ROOF);
        await publishV2(libraryId);

        const result = await svc.updateLibraryImport(libraryId, { mode: 'replace', userId: USER });
        expect(result.rowsPreserved).toBe(1);
    });

    it('destroys the rewrite only when the caller has explicitly accepted the loss', async () => {
        const libraryId = await importV1();
        rewriteRow(await roofRowId(libraryId), REWRITTEN_ROOF);
        await publishV2(libraryId);

        await svc.updateLibraryImport(libraryId, {
            mode: 'replace',
            confirmLossOfEdits: true,
            userId: USER,
        });

        const texts = (await testDb.select().from(schema.comments)
            .where(eq(schema.comments.tenantId, TENANT)).all()).map(r => r.text);
        expect(texts).not.toContain(REWRITTEN_ROOF);
        expect(texts.sort()).toEqual([UNTOUCHED, V2_ROOF].sort());
    });

    it('treats a comment edited and then changed back as no conflict', async () => {
        const libraryId = await importV1();
        const id = await roofRowId(libraryId);
        rewriteRow(id, REWRITTEN_ROOF);
        rewriteRow(id, V1_ROOF);
        await publishV2(libraryId);

        const result = await svc.updateLibraryImport(libraryId, { mode: 'replace', userId: USER });
        expect(result.rowsPreserved).toBe(0);

        const texts = (await testDb.select().from(schema.comments)
            .where(eq(schema.comments.tenantId, TENANT)).all()).map(r => r.text).sort();
        expect(texts).toEqual([UNTOUCHED, V2_ROOF].sort());
    });

    it('does not raise a row the publisher left alone in v2', async () => {
        const libraryId = await importV1();
        // The tenant rewrites the plumbing line; v2 changes only the roof line.
        const plumbing = await testDb.select().from(schema.comments)
            .where(and(eq(schema.comments.tenantId, TENANT), eq(schema.comments.text, UNTOUCHED))).get();
        rewriteRow(plumbing!.id, 'Water heater is at the end of its service life; budget for replacement.');
        await publishV2(libraryId);

        const preview = await svc.previewLibraryReplace(libraryId);
        expect(preview.publisherChanged).toBe(1);
        expect(preview.edited).toBe(1);
        expect(preview.pairs).toHaveLength(1);
        expect(preview.pairs[0]!.published.kind).toBe('unchanged');
    });

    it('previews the pair an inspector needs to read before choosing', async () => {
        const libraryId = await importV1();
        rewriteRow(await roofRowId(libraryId), REWRITTEN_ROOF);
        await publishV2(libraryId);

        const preview = await svc.previewLibraryReplace(libraryId);
        expect(preview.libraryName).toBe('Regional Roofing Pack');
        expect(preview.fromSemver).toBe('1.0.0');
        expect(preview.toSemver).toBe('2.0.0');
        expect(preview.total).toBe(2);
        expect(preview.publisherChanged).toBe(1);
        expect(preview.edited).toBe(1);
        expect(preview.pairs).toHaveLength(1);
        expect(preview.pairs[0]!.yours).toBe(REWRITTEN_ROOF);
        expect(preview.pairs[0]!.published).toEqual({ kind: 'changed', text: V2_ROOF });
    });

    it('never reaches another tenant rows when preserving edits', async () => {
        const other = '00000000-0000-0000-0000-000000000002';
        await testDb.insert(schema.tenants).values({
            id: other, slug: 'o', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        const libraryId = await importV1();
        await testDb.insert(schema.comments).values({
            id: crypto.randomUUID(), tenantId: other, text: 'Other tenant copy',
            category: null, libraryId, createdAt: new Date(),
        });
        rewriteRow(await roofRowId(libraryId), REWRITTEN_ROOF);
        await publishV2(libraryId);

        await svc.updateLibraryImport(libraryId, { mode: 'replace', confirmLossOfEdits: true, userId: USER });

        const surviving = await testDb.select().from(schema.comments)
            .where(eq(schema.comments.tenantId, other)).all();
        expect(surviving).toHaveLength(1);
    });
});
