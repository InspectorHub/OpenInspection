/**
 * Characterises the seeder behind `POST /api/admin/data/install-bundled-content`
 * (content-delivery-across-upgrades spec).
 *
 * The route calls the SAME canonical `seedStarterContent` both provisioning
 * paths already use — there is no second implementation — so what the route
 * promises an owner is exactly what these four assertions describe. The third
 * one in particular is the boundary the Settings → Data copy has to survive:
 * the skip check is by NAME, so a renamed row no longer matches and comes back
 * as a second copy. That is documented behaviour, pinned here so a future
 * change to the skip key has to face the copy.
 *
 * `drizzle-orm/d1` is mocked so the service's `drizzle(db)` returns the
 * better-sqlite3 instance; the raw D1 adapter is still passed because that is
 * the signature both real callers use (`c.env.DB` / `dbBinding`).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { templates, tenants } from '../../../server/lib/db/schema';
import { createTestDb, setupSchema, toRawD1 } from '../db';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { seedStarterContent } from '../../../server/services/starter-content.service';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTHER_TENANT = '00000000-0000-0000-0000-000000000002';

describe('install bundled content', () => {
    let fix: ReturnType<typeof createTestDb>;
    let testDb: BetterSQLite3Database<typeof schema>;

    // Defined here, not imported — `tests/unit/db.ts` exports only
    // createTestDb / setupSchema / toRawD1, and there is no tenant fixture.
    // `tenants` has four NOT NULL columns without a default: id, name, slug,
    // created_at (tier / status / max_users / deployment_mode / applied_*_seq
    // all carry one). The slug is UNIQUE, and the two ids below differ only in
    // their LAST character — so it is derived from the whole id, not a prefix.
    const seedTenantRow = (id: string) =>
        testDb.insert(tenants).values({
            id, slug: `ws-${id}`,
            createdAt: new Date(),
        } as typeof tenants.$inferInsert);

    beforeEach(async () => {
        fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        const { drizzle } = await import('drizzle-orm/d1');
        (drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        await seedTenantRow(TENANT);
    });

    afterEach(() => {
        fix.sqlite.close();
        vi.clearAllMocks();
    });

    it('seeds the bundled templates on a tenant that has none', async () => {
        await seedStarterContent(toRawD1(fix.sqlite), TENANT);
        const rows = await testDb.select().from(templates);
        expect(rows.length).toBeGreaterThan(0);
    });

    it('is idempotent — a second run adds nothing', async () => {
        await seedStarterContent(toRawD1(fix.sqlite), TENANT);
        const after1 = (await testDb.select().from(templates)).length;
        await seedStarterContent(toRawD1(fix.sqlite), TENANT);
        expect((await testDb.select().from(templates)).length).toBe(after1);
    });

    // The boundary the UI copy has to survive. This is not a bug being pinned —
    // it is the documented behaviour, asserted so that a future change to the
    // skip key has to face the copy in Settings → Data.
    it('re-adds a RENAMED row, because the skip check is by name', async () => {
        await seedStarterContent(toRawD1(fix.sqlite), TENANT);
        const one = (await testDb.select().from(templates).limit(1))[0]!;
        await testDb.update(templates).set({ name: 'My Renamed Template' })
            .where(eq(templates.id, one.id));
        await seedStarterContent(toRawD1(fix.sqlite), TENANT);
        const names = (await testDb.select().from(templates)).map(r => r.name);
        expect(names).toContain('My Renamed Template');
        expect(names).toContain(one.name);   // the original name is back
    });

    it('does not touch another tenant', async () => {
        await seedTenantRow(OTHER_TENANT);
        await seedStarterContent(toRawD1(fix.sqlite), TENANT);
        const other = await testDb.select().from(templates)
            .where(eq(templates.tenantId, OTHER_TENANT));
        expect(other).toHaveLength(0);
    });
});
