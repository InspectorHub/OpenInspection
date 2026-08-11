/**
 * Every inspection is born with an `inspection_results` row.
 *
 * The collaborative editor's Durable Object records findings by UPDATEing that
 * row. An UPDATE matching no row changes nothing and reports no error, so an
 * inspection created without one accepted edits that never reached the database:
 * the socket read "Connected", ratings filled in, the Issues counter moved — and
 * a published report carried none of it.
 *
 * The DO now inserts as a fallback (tests/workers/collab-persist-without-row),
 * but the invariant is asserted here, at the point the inspection is created,
 * because that is where it can be guaranteed rather than repaired.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InspectionService } from '../../../server/services/inspection.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import { ScopedDB } from '../../../server/lib/db/scoped';
import { createTestDb, setupSchema } from '../db';
import { asD1Db } from '../helpers/test-db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-0000000000cc';

let testDb: BetterSQLite3Database<typeof schema>;
let inspectionSvc: InspectionService;

beforeEach(async () => {
    const fixture = createTestDb();
    testDb = fixture.db;
    await setupSchema(fixture.sqlite);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockDrizzle as any).mockReturnValue(testDb);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sdb = new ScopedDB(testDb as any, TENANT);

    await testDb.insert(schema.tenants).values({
        id: TENANT, slug: 'results-co', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await seedRoleProfiles(asD1Db(testDb), TENANT, new Date());

    inspectionSvc = new InspectionService({} as D1Database, undefined, sdb);
});

describe('createInspection — results row', () => {
    it('creates the row the collab document writes into', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await inspectionSvc.createInspection(TENANT, { propertyAddress: '1 Findings Way' } as any);

        const inspection = await testDb.select().from(schema.inspections).get();
        const results = await testDb
            .select()
            .from(schema.inspectionResults)
            .where(eq(schema.inspectionResults.inspectionId, inspection!.id))
            .get();

        expect(results, 'an inspection with no results row silently loses every edit').toBeTruthy();
        expect(results!.tenantId).toBe(TENANT);
    });

    it('starts empty — creation records no findings of its own', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await inspectionSvc.createInspection(TENANT, { propertyAddress: '2 Findings Way' } as any);

        const results = await testDb.select().from(schema.inspectionResults).get();
        const data = typeof results!.data === 'string'
            ? (JSON.parse(results!.data) as Record<string, unknown>)
            : (results!.data as Record<string, unknown>);
        expect(Object.keys(data)).toHaveLength(0);
    });

    it('binds the row to the primary report, not to the inspection alone', async () => {
        // One order can now deliver several documents, and `inspection_results`
        // is per REPORT — `uq_results_report` replaced `uq_results_inspection`.
        // But that index is unique on a NULLABLE column, so a row written
        // without `report_id` is accepted, and any number of them are: nothing
        // errors, and every per-report read either matches no document or
        // matches a sibling's. Creation is the only place the binding can be
        // guaranteed rather than guessed at.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await inspectionSvc.createInspection(TENANT, { propertyAddress: '5 Findings Way' } as any);

        const inspection = await testDb.select().from(schema.inspections).get();
        const report = await testDb
            .select()
            .from(schema.reports)
            .where(eq(schema.reports.inspectionId, inspection!.id))
            .get();
        const results = await testDb
            .select()
            .from(schema.inspectionResults)
            .where(eq(schema.inspectionResults.inspectionId, inspection!.id))
            .get();

        expect(report, 'the order was born without a primary report').toBeTruthy();
        expect(
            results!.reportId,
            'the results row carries no report_id — the document belongs to no report',
        ).toBe(report!.id);
    });

    it('binds a re-inspection results row to the re-inspection own primary report', async () => {
        // The second creation path, and the one that looks most like the first
        // — which is exactly why it is the one that gets fixed in only one
        // place. A re-inspection is its own order with its own primary report.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const baseline = await inspectionSvc.createInspection(TENANT, { propertyAddress: '6 Findings Way' } as any);
        // `createReinspection` refuses an unpublished baseline, and it reads the
        // latest published snapshot rather than the live row.
        await testDb.insert(schema.reportVersions).values({
            id: 'ver-baseline-1', tenantId: TENANT, inspectionId: baseline.id, versionNumber: 1,
            snapshotJson: JSON.stringify({ inspection: {}, data: {}, units: [] }),
            publishedAt: new Date(), publishedBy: 'tester', createdAt: new Date(),
        } as never);

        const reinspection = await inspectionSvc.createReinspection(TENANT, baseline.id, { selectedItemIds: [] });

        const report = await testDb
            .select()
            .from(schema.reports)
            .where(eq(schema.reports.inspectionId, reinspection.id))
            .get();
        const results = await testDb
            .select()
            .from(schema.inspectionResults)
            .where(eq(schema.inspectionResults.inspectionId, reinspection.id))
            .get();

        expect(report).toBeTruthy();
        expect(results!.reportId).toBe(report!.id);
    });

    it('gives each inspection its own row', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await inspectionSvc.createInspection(TENANT, { propertyAddress: '3 Findings Way' } as any);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await inspectionSvc.createInspection(TENANT, { propertyAddress: '4 Findings Way' } as any);

        const rows = await testDb.select().from(schema.inspectionResults).all();
        expect(rows).toHaveLength(2);
        expect(new Set(rows.map((r) => r.inspectionId)).size).toBe(2);
    });
});
