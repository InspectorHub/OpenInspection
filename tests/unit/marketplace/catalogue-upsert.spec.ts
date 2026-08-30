/**
 * The catalogue seeder is the ONLY writer of what a pack contains, so it is
 * also the only thing that can carry a repository change into a deployment that
 * already holds the row. Filtering by name and inserting only what was missing
 * left no path at all from source control to an existing catalogue.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { TestDb } from '../helpers/test-db';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { seedStarterContent } from '../../../server/services/starter-content.service';
import { asD1DrizzleReturn } from '../helpers/test-db';

const TENANT = 'tenant-catalogue-1';

describe('catalogue seeding', () => {
    let db: TestDb;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        sqlite = fixture.sqlite;
        await setupSchema(sqlite);
        vi.mocked(mockDrizzle).mockReturnValue(asD1DrizzleReturn(db));
        await db.insert(schema.tenants).values({
            id: TENANT, slug: 'catalogue', createdAt: new Date(),
        });
    });
    afterEach(() => { sqlite.close(); vi.clearAllMocks(); });

    it('updates an existing row whose semver moved, instead of skipping it', async () => {
        await seedStarterContent({} as unknown as D1Database, TENANT);
        const before = await db.select().from(schema.marketplaceLibraries).all();
        expect(before.length).toBeGreaterThan(0);
        const row = before[0];

        // Simulate a deployment that is behind: pretend the stored row is older,
        // and that tenants have been installing it in the meantime.
        await db.update(schema.marketplaceLibraries)
            .set({ semver: '0.0.1', downloadCount: 7 })
            .where(eq(schema.marketplaceLibraries.id, row.id));

        const result = await seedStarterContent({} as unknown as D1Database, TENANT);

        const after = await db.select().from(schema.marketplaceLibraries)
            .where(eq(schema.marketplaceLibraries.id, row.id)).get();
        // The repository is the source of truth for semver and schema...
        expect(after?.semver).toBe(row.semver);
        // ...but the id must not move: tenant_library_imports.libraryId points
        // at it, and a new id would orphan every tenant that installed.
        expect(after?.id).toBe(row.id);
        // ...and downloadCount is the tenants' history, not the repository's.
        expect(after?.downloadCount).toBe(7);
        // A refresh is reported, not silently folded into zero.
        expect(result.marketplaceLibrariesSeeded).toBe(1);

        // Refreshing must not duplicate the row it refreshed.
        const all = await db.select().from(schema.marketplaceLibraries).all();
        expect(all).toHaveLength(before.length);
    });

    it('seeds the statutory package as its own kind, carrying its declaration', async () => {
        // The catalogue is how a self-hosted operator gets a statutory form at
        // all: the browse page is the only door, and until this fixture existed
        // the shelf behind it held one comment pack. The kind is the load-bearing
        // part — it is what decides which validator the import runs and what an
        // un-install undoes — so it is asserted rather than the row's presence.
        await seedStarterContent({} as unknown as D1Database, TENANT);
        const row = await db.select().from(schema.marketplaceLibraries)
            .where(eq(schema.marketplaceLibraries.kind, 'statutory')).get();

        expect(row, 'no statutory entry reached the catalogue').toBeDefined();
        expect(row?.jurisdiction).toBe('TX');

        // The schema must be the TEMPLATE DOCUMENT, not a description of one.
        // A row whose schema said "Texas TREC REI 7-6" in prose would satisfy
        // every assertion about names and kinds above, install cleanly past a
        // validator that only reads shape, and produce a blank document.
        const declared = (row?.schema as { statutoryForm?: { formId?: string; revision?: string } })
            ?.statutoryForm;
        expect(declared?.formId).toBe('tx_trec_rei_7_6');
        expect(declared?.revision).toBe('REI 7-6');
    });

    it('refreshes the statutory row without moving its id or its download count', async () => {
        // The same invariant as the first test, asserted against the statutory
        // row specifically. That test reads `before[0]`, whose identity is
        // whatever the select happened to return first — it proved the seeder
        // refreshes A row, and a seeder that handled only the comments kind
        // would have passed it unchanged.
        await seedStarterContent({} as unknown as D1Database, TENANT);
        const before = await db.select().from(schema.marketplaceLibraries)
            .where(eq(schema.marketplaceLibraries.kind, 'statutory')).get();
        const id = before!.id;

        await db.update(schema.marketplaceLibraries)
            .set({ semver: '0.0.1', downloadCount: 11 })
            .where(eq(schema.marketplaceLibraries.id, id));

        const result = await seedStarterContent({} as unknown as D1Database, TENANT);
        const after = await db.select().from(schema.marketplaceLibraries)
            .where(eq(schema.marketplaceLibraries.id, id)).get();

        expect(after?.semver).toBe(before!.semver);
        // An implementation that rewrote the whole row would pass the line above
        // and orphan every tenant_library_imports.libraryId pointing here, and
        // replace the tenants' own install history with a number from source
        // control. Both are asserted because both are invisible when wrong.
        expect(after?.id).toBe(id);
        expect(after?.downloadCount).toBe(11);
        expect(result.marketplaceLibrariesSeeded).toBe(1);
    });

    it('reports nothing when the repository and the catalogue already agree', async () => {
        // The positive control. Without it, code that refreshed EVERY row on
        // every run would satisfy the assertion above just as happily, and the
        // "update available" badge would then be driven by a column this seeder
        // rewrites on every deployment.
        await seedStarterContent({} as unknown as D1Database, TENANT);
        const second = await seedStarterContent({} as unknown as D1Database, TENANT);
        expect(second.marketplaceLibrariesSeeded).toBe(0);
    });
});
