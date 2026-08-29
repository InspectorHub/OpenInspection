import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { MarketplaceService } from '../../../server/services/marketplace.service';
import { marketplaceLibraries } from '../../../server/lib/db/schema/marketplace';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema, toRawD1 } from '../db';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-000000000001';

const ordinaryDoc = { schemaVersion: 2, sections: [] };
const statutoryDoc = {
    schemaVersion: 2,
    sections: [],
    statutoryForm: { formId: 'tx_trec_rei', bindings: {} },
};

describe('updating an installed catalogue template', () => {
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
    });

    afterEach(() => { sqlite.close(); vi.clearAllMocks(); });

    async function seedEntry(
        id: string, kind: 'templates' | 'statutory', doc: unknown, semver: string,
    ) {
        const now = new Date();
        await testDb.insert(marketplaceLibraries).values({
            id, name: `Entry ${id}`, kind, semver, schema: JSON.stringify(doc),
            authorId: 'system', changelog: null, downloadCount: 0, featured: false,
            createdAt: now, updatedAt: now,
            propertyType: null, jurisdiction: null, inspectionKind: null,
        } as typeof marketplaceLibraries.$inferInsert);
    }

    async function bump(id: string, semver: string) {
        await testDb.update(marketplaceLibraries)
            .set({ semver }).where(eq(marketplaceLibraries.id, id));
    }

    const retiredAtOf = async (id: string) => (await testDb.select().from(schema.templates)
        .where(eq(schema.templates.id, id)).get())?.retiredAt ?? null;

    it('retires the superseded template so nobody starts a new inspection on it', async () => {
        await seedEntry('stat-1', 'statutory', statutoryDoc, '1.0.0');
        await svc.importCatalogEntry('stat-1', 'u1');
        await bump('stat-1', '1.1.0');

        const r = await svc.updateTemplateImport('stat-1', 'u1');

        // Retired, not deleted: inspections.template_id carries a legacy foreign
        // key to it, and re-issuing an old report reads the inspection's own
        // snapshot anyway.
        expect(await retiredAtOf(r.oldLocalId!)).not.toBeNull();
        expect(await retiredAtOf(r.newLocalId)).toBeNull();
        // Nothing was removed.
        expect(await testDb.select().from(schema.templates).all()).toHaveLength(2);
    });

    it('leaves an ordinary template import alone', async () => {
        // The positive control for the branch: retiring is a statutory-only
        // behaviour, and a test that only asserted "the old one is retired"
        // would pass just as happily if the code retired every kind.
        await seedEntry('tpl-1', 'templates', ordinaryDoc, '1.0.0');
        await svc.importCatalogEntry('tpl-1', 'u1');
        await bump('tpl-1', '1.1.0');

        const r = await svc.updateTemplateImport('tpl-1', 'u1');

        expect(await retiredAtOf(r.oldLocalId!)).toBeNull();
        expect(await retiredAtOf(r.newLocalId)).toBeNull();
    });

    it('validates the new statutory revision with the statutory schema', async () => {
        // Without this the update path would gate the new revision on the
        // tenant-facing validator, which refuses a declaration — so a statutory
        // package could be installed and then never updated.
        await seedEntry('stat-2', 'statutory', statutoryDoc, '1.0.0');
        await svc.importCatalogEntry('stat-2', 'u1');
        await bump('stat-2', '1.1.0');

        const r = await svc.updateTemplateImport('stat-2', 'u1');
        const fresh = await testDb.select().from(schema.templates)
            .where(eq(schema.templates.id, r.newLocalId)).get();
        const stored = JSON.parse(fresh!.schema as string) as { statutoryForm?: { formId?: string } };
        expect(stored.statutoryForm?.formId).toBe('tx_trec_rei');
    });
});
