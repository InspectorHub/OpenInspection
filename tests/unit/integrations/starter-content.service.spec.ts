/**
 * Trial Sample-Data Mode (2026-05-20 spec) — starter content seeding tests.
 *
 * Pattern mirrors tests/unit/admin.service.spec.ts: in-memory better-sqlite3
 * with the real migration set applied. The `drizzle-orm/d1` module is mocked
 * so the production code's `drizzle(db as any)` call returns the better-sqlite3
 * Drizzle instance instead of a real D1 binding.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { seedStarterContent } from '../../../server/services/starter-content.service';
import { CONTRACTOR_TYPES } from '../../../server/services/starter-content/fixtures/contractor-types';
import { DEFECT_TRADES } from '../../../server/types/defect-fields';

describe('seedStarterContent', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sqlite: any;
    const tenantId = 'tenant-test-1';

    beforeEach(async () => {
        const setup = createTestDb();
        testDb = setup.db;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);

        // Seed a tenant row to satisfy FKs.
        await testDb.insert(schema.tenants).values({
            id:        tenantId,
            slug: 'test',
            createdAt: new Date(),
        });
    });

    afterEach(() => {
        sqlite.close();
        vi.clearAllMocks();
    });

    it('seeds expected counts of each starter-content type', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await seedStarterContent({} as any, tenantId);

        expect(result.inspectionTemplatesSeeded).toBe(7);
        expect(result.agreementTemplatesSeeded).toBe(1);
        expect(result.cannedCommentsSeeded).toBe(254);
        // 7 since the two event-type seed lists were merged: the three main
        // visits plus the radon pair, mold and water tests that the seeded
        // service catalogue references.
        expect(result.eventTypesSeeded).toBe(7);
        expect(result.tagsSeeded).toBe(4);
        expect(result.recommendationsSeeded).toBeGreaterThan(0);
        expect(result.ratingSystemsSeeded).toBeGreaterThan(0);
        expect(result.marketplaceLibrariesSeeded).toBeGreaterThan(0);
        // Derived, not a literal: the seed is computed from `DEFECT_TRADES` now,
        // so a hard-coded count would have to be edited every time the trade
        // vocabulary grows — which is the coupling this change removed.
        expect(result.contractorTypesSeeded).toBe(CONTRACTOR_TYPES.length);
    });

    it('is idempotent — calling twice does not duplicate rows', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await seedStarterContent({} as any, tenantId);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const second = await seedStarterContent({} as any, tenantId);

        // Second call inserts nothing — every fixture row was already present.
        expect(second.inspectionTemplatesSeeded).toBe(0);
        expect(second.agreementTemplatesSeeded).toBe(0);
        expect(second.cannedCommentsSeeded).toBe(0);
        expect(second.eventTypesSeeded).toBe(0);
        expect(second.tagsSeeded).toBe(0);
        expect(second.recommendationsSeeded).toBe(0);
        expect(second.ratingSystemsSeeded).toBe(0);
        expect(second.marketplaceLibrariesSeeded).toBe(0);
        expect(second.contractorTypesSeeded).toBe(0);
    });

    it('agreement template content starts with bolded disclaimer', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await seedStarterContent({} as any, tenantId);
        const row = await testDb.select({ content: schema.agreements.content })
            .from(schema.agreements)
            .where(eq(schema.agreements.tenantId, tenantId))
            .get();
        expect(row).toBeDefined();
        expect(row!.content.startsWith('**⚠️ Review before sending to real customers.**')).toBe(true);
        expect(row!.content).toContain('not legal advice');
    });

    it('event_types align with inspection-template names', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await seedStarterContent({} as any, tenantId);
        const rows = await testDb.select({ name: schema.eventTypes.name })
            .from(schema.eventTypes)
            .where(eq(schema.eventTypes.tenantId, tenantId))
            .all();
        const names = rows.map(r => r.name as string);
        expect(names).toContain('Standard Home Inspection');
        expect(names).toContain('Pre-Listing Inspection');
        expect(names).toContain('Sewer Scope');
    });

    it('tags use the expected colors', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await seedStarterContent({} as any, tenantId);
        const rows = await testDb.select({ name: schema.tags.name, color: schema.tags.color })
            .from(schema.tags)
            .where(eq(schema.tags.tenantId, tenantId))
            .all();
        const colorByName: Record<string, string | null> = {};
        for (const r of rows) colorByName[r.name as string] = (r.color as string | null);

        expect(colorByName['Safety concern']).toBe('red');
        expect(colorByName['Needs maintenance']).toBe('yellow');
        expect(colorByName['Cosmetic']).toBe('gray');
        expect(colorByName['Follow-up needed']).toBe('blue');
    });

    it('seeds a contractor type per canonical trade, carrying its slug', async () => {
        // Was ten hand-written names in a literal here. The seed is DERIVED from
        // `DEFECT_TRADES` now (#277), so pinning the names again would recreate
        // exactly the copy the derivation removed — assert the DERIVATION held
        // instead. The fixture's own shape is covered in
        // starter-content-contractor-types.spec.ts.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await seedStarterContent({} as any, tenantId);
        const rows = await testDb.select({
            name: schema.contractorTypes.name,
            sortOrder: schema.contractorTypes.sortOrder,
            tradeSlug: schema.contractorTypes.tradeSlug,
        })
            .from(schema.contractorTypes)
            .where(eq(schema.contractorTypes.tenantId, tenantId))
            .all();
        const ordered = rows.sort((a, b) => (a.sortOrder as number) - (b.sortOrder as number));

        expect(ordered).toEqual(CONTRACTOR_TYPES.map((c) => ({
            name: c.name, sortOrder: c.sortOrder, tradeSlug: c.tradeSlug,
        })));
        // The slug is what survives a rename, so its ABSENCE on a canonical row
        // is the failure that matters — a null here silently un-maps a trade.
        expect(ordered.filter((r) => r.tradeSlug !== null)).toHaveLength(DEFECT_TRADES.length);
    });

    it('does not re-seed a canonical type the tenant has RENAMED', async () => {
        // The reason the seed matches on slug rather than name. There is no
        // unique index on this table, so a name-keyed seed would insert a second
        // row for a trade the workspace already has and nothing would object.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await seedStarterContent({} as any, tenantId);
        await testDb.update(schema.contractorTypes)
            .set({ name: 'Our Sparky' })
            .where(eq(schema.contractorTypes.tradeSlug, 'licensed-electrician'))
            .run();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await seedStarterContent({} as any, tenantId);
        const electricians = await testDb.select({ name: schema.contractorTypes.name })
            .from(schema.contractorTypes)
            .where(eq(schema.contractorTypes.tradeSlug, 'licensed-electrician'))
            .all();
        expect(electricians).toHaveLength(1);
        expect(electricians[0]?.name).toBe('Our Sparky');
    });
});
