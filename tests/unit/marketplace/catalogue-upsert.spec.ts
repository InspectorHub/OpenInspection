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
