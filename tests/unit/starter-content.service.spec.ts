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
import * as schema from '../../server/lib/db/schema';
import { createTestDb, setupSchema } from './db';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { seedStarterContent } from '../../server/services/starter-content.service';

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
            name:      'Test Tenant',
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
        expect(result.eventTypesSeeded).toBe(3);
        expect(result.tagsSeeded).toBe(4);
        expect(result.recommendationsSeeded).toBeGreaterThan(0);
        expect(result.ratingSystemsSeeded).toBeGreaterThan(0);
        expect(result.marketplaceLibrariesSeeded).toBeGreaterThan(0);
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
});
