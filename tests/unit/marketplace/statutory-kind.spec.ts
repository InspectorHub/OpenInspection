import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { StatutoryTemplateSchema } from '../../../server/lib/validations/statutory-template.schema';
import { TemplateSchemaV2Schema } from '../../../server/lib/validations/template.schema';
import { MarketplaceService } from '../../../server/services/marketplace.service';
import { marketplaceLibraries, tenantLibraryImports } from '../../../server/lib/db/schema/marketplace';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema, toRawD1 } from '../db';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-000000000001';

const withDeclaration = {
    schemaVersion: 2,
    sections: [],
    // A form this software does NOT publish, and that is load-bearing rather than
    // arbitrary: these specs are about install/uninstall bookkeeping, and
    // `assertStatutoryInstallable` demands the authority's own PDF in object storage
    // for any revision the catalogue really does publish. Naming a published form
    // here would make every test below depend on bytes this suite has no reason to
    // hold. It read `tx_trec_rei` until that became the published TREC id.
    statutoryForm: { formId: 'zz_unpublished_form', bindings: {} },
};

describe('the statutory import validator', () => {
    it('accepts a declaration, which the tenant-facing schema must not', () => {
        expect(StatutoryTemplateSchema.safeParse(withDeclaration).success).toBe(true);
    });

    it('the tenant-facing schema STILL refuses it — the door stays shut', () => {
        // The regression net for the one place this design relaxes anything. If
        // somebody ever "fixes" the import by adding the key to the tenant-facing
        // object, that is not a loosened validator: it is a decision that a
        // workspace may declare its own official form, and this test is what
        // makes that decision impossible to make by accident.
        const r = TemplateSchemaV2Schema.safeParse(withDeclaration);
        expect(r.success).toBe(false);
        expect(JSON.stringify(r.error?.issues)).toContain('unrecognized_keys');
    });

    it('is still strict about everything else', () => {
        // Relaxed for ONE key, not turned off.
        const r = StatutoryTemplateSchema.safeParse({ ...withDeclaration, somethingElse: 1 });
        expect(r.success).toBe(false);
    });

    it('refuses a declaration that is missing its form id', () => {
        // The positive control for the extension itself: a schema that admitted
        // ANY object under `statutoryForm` would pass the first case above just
        // as happily, and would then let a declaration with nothing in it become
        // a template that claims to produce an authority's form.
        const r = StatutoryTemplateSchema.safeParse({
            schemaVersion: 2, sections: [], statutoryForm: { bindings: {} },
        });
        expect(r.success).toBe(false);
    });
});

describe('importing a kind=statutory catalogue entry', () => {
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

    async function seedEntry(id: string, over: Partial<typeof marketplaceLibraries.$inferInsert> = {}) {
        const now = new Date();
        await testDb.insert(marketplaceLibraries).values({
            id, name: 'TREC REI', kind: 'statutory', semver: '1.0.0',
            schema: JSON.stringify(withDeclaration),
            authorId: 'system', changelog: null, downloadCount: 0, featured: false,
            createdAt: now, updatedAt: now,
            propertyType: null, jurisdiction: 'TX', inspectionKind: null,
            ...over,
        } as typeof marketplaceLibraries.$inferInsert);
    }

    it('mints one local template carrying the declaration, and records its id', async () => {
        await seedEntry('stat-1');

        const result = await svc.importCatalogEntry('stat-1', 'u1');

        expect(result.kind).toBe('statutory');
        expect(result.rowCount).toBe(0);
        expect(result.localEntityId).toBeTruthy();

        const locals = await testDb.select().from(schema.templates).all();
        expect(locals).toHaveLength(1);
        expect(locals[0]!.id).toBe(result.localEntityId);
        // The declaration is what the produce path reads from the inspection's
        // snapshot. An import that dropped it would install a template that
        // looks right and produces nothing.
        const stored = JSON.parse(locals[0]!.schema as string) as { statutoryForm?: { formId?: string } };
        expect(stored.statutoryForm?.formId).toBe('zz_unpublished_form');

        const [marker] = await testDb.select().from(tenantLibraryImports).all();
        expect(marker!.localEntityId).toBe(result.localEntityId);
        expect(marker!.importedSemver).toBe('1.0.0');
    });

    it('refuses a statutory entry whose schema is not a valid template', async () => {
        // The negative control for the branch. The extended validator is the one
        // place this design relaxes anything, so "it accepts the row it was
        // given" is not enough — it has to still refuse a bad one.
        await seedEntry('stat-bad', {
            schema: JSON.stringify({ schemaVersion: 2, sections: [], statutoryForm: { bindings: {} } }),
        });

        await expect(svc.importCatalogEntry('stat-bad', 'u1')).rejects.toThrow(/statutory template/i);
        expect(await testDb.select().from(schema.templates).all()).toHaveLength(0);
    });
});
