/**
 * Commercial PCA Phase U — UnitSwitchService orchestrator tests.
 *
 * Exercises the DB side effects of the tagged <-> per_unit switch against a
 * real better-sqlite3 db: unit promotion, finding re-keying, results
 * persistence, location_options union, unit deletion, and mode flip. The pure
 * rewrites are covered separately (unit-switch.spec.ts); this pins the
 * orchestration those pure functions are wrapped in.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { UnitSwitchService } from '../../../server/services/unit-switch.service';
import { UnitService } from '../../../server/services/unit.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-000000000099';
const INSPECTION = '11111111-1111-1111-1111-111111111111';
const RESULTS = '22222222-2222-2222-2222-222222222222';

async function seed(
    testDb: BetterSQLite3Database<typeof schema>,
    opts: { locationOptions?: string[]; mode?: 'tagged' | 'per_unit'; data?: Record<string, unknown> },
) {
    await testDb.insert(schema.tenants).values({
        id: TENANT, name: 'Acme', slug: 'acme', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await testDb.insert(schema.inspections).values({
        id: INSPECTION, tenantId: TENANT,
        propertyAddress: '1 Main St',
        date: '2026-06-01', status: 'requested', paymentStatus: 'unpaid', price: 0,
        paymentRequired: false, agreementRequired: false, createdAt: new Date(),
        locationOptions: opts.locationOptions ?? [],
        unitInspectionMode: opts.mode ?? 'tagged',
    });
    await testDb.insert(schema.inspectionResults).values({
        id: RESULTS, tenantId: TENANT, inspectionId: INSPECTION,
        data: opts.data ?? {}, lastSyncedAt: new Date(),
    });
}

async function readData(testDb: BetterSQLite3Database<typeof schema>): Promise<Record<string, unknown>> {
    const row = await testDb.select().from(schema.inspectionResults)
        .where(eq(schema.inspectionResults.id, RESULTS)).get();
    return row!.data as Record<string, unknown>;
}

async function readMode(testDb: BetterSQLite3Database<typeof schema>): Promise<string> {
    const row = await testDb.select().from(schema.inspections)
        .where(eq(schema.inspections.id, INSPECTION)).get();
    return (row as { unitInspectionMode: string }).unitInspectionMode;
}

describe('UnitSwitchService', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let switchSvc: UnitSwitchService;
    let unitSvc: UnitService;

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        switchSvc = new UnitSwitchService({} as D1Database);
        unitSvc = new UnitService({} as D1Database);
    });

    it('toPerUnit promotes location_options into units and re-keys unambiguous findings', async () => {
        await seed(testDb, {
            locationOptions: ['101', '102'],
            data: {
                '_default:kitchen:sink': { rating: 'd', tabs: { defects: [{ included: true, location: '101' }] } },
                '_default:roof:flash': { rating: 'g' }, // common, no location → stays _default
            },
        });

        const out = await switchSvc.toPerUnit(TENANT, INSPECTION);
        expect(out.mode).toBe('per_unit');
        expect(out.created.sort()).toEqual(['101', '102']);

        const units = await unitSvc.list(TENANT, INSPECTION);
        expect(units.map((u) => u.name).sort()).toEqual(['101', '102']);
        const u101 = units.find((u) => u.name === '101')!;

        const data = await readData(testDb);
        // The 101-located finding moved onto unit 101's scope; the common one stayed.
        // Both sides sorted: unit ids are random UUIDs, so a fixed expected order
        // would flake on whether the id's first hex char sorts before/after '_'.
        expect(Object.keys(data).sort()).toEqual([`${u101.id}:kitchen:sink`, '_default:roof:flash'].sort());
        expect(await readMode(testDb)).toBe('per_unit');
    });

    it('toPerUnit is idempotent — a second run creates no duplicate units and re-keys nothing new', async () => {
        await seed(testDb, {
            locationOptions: ['101'],
            data: { '_default:kitchen:sink': { tabs: { defects: [{ included: true, location: '101' }] } } },
        });
        await switchSvc.toPerUnit(TENANT, INSPECTION);
        const firstData = await readData(testDb);
        const second = await switchSvc.toPerUnit(TENANT, INSPECTION);
        expect(second.created).toEqual([]); // '101' already a unit
        expect(await unitSvc.list(TENANT, INSPECTION)).toHaveLength(1);
        expect(await readData(testDb)).toEqual(firstData);
    });

    it('toTagged keeps a ZERO-finding unit label in location_options (regression: MAJOR-1)', async () => {
        await seed(testDb, { mode: 'per_unit' });
        // Three units; only 101 carries a finding. 102/103 are empty.
        const u101 = await unitSvc.create(TENANT, { inspectionId: INSPECTION, parentUnitId: null, kind: 'unit', name: '101' });
        await unitSvc.create(TENANT, { inspectionId: INSPECTION, parentUnitId: null, kind: 'unit', name: '102' });
        await unitSvc.create(TENANT, { inspectionId: INSPECTION, parentUnitId: null, kind: 'unit', name: '103' });
        await testDb.update(schema.inspectionResults)
            .set({ data: { [`${u101.id}:kitchen:sink`]: { rating: 'd', tabs: { defects: [{ included: true }] } } } })
            .where(eq(schema.inspectionResults.id, RESULTS));

        const out = await switchSvc.toTagged(TENANT, INSPECTION);
        expect(out.mode).toBe('tagged');
        // All three unit labels survive — the empty ones would be lost if options
        // were derived only from finding keys.
        expect(out.locationOptions.sort()).toEqual(['101', '102', '103']);

        // Units removed; finding demoted to _default with the unit label stamped.
        expect(await unitSvc.list(TENANT, INSPECTION)).toHaveLength(0);
        const data = await readData(testDb);
        expect(Object.keys(data)).toEqual(['_default:kitchen:sink']);
        const defect = (data['_default:kitchen:sink'] as { tabs: { defects: { location?: string }[] } }).tabs.defects[0];
        expect(defect.location).toBe('101');
        expect(await readMode(testDb)).toBe('tagged');
    });

    it('round-trips tagged -> per_unit -> tagged preserving the located finding', async () => {
        await seed(testDb, {
            locationOptions: ['101'],
            data: { '_default:kitchen:sink': { rating: 'd', tabs: { defects: [{ included: true, location: '101' }] } } },
        });
        await switchSvc.toPerUnit(TENANT, INSPECTION);
        const back = await switchSvc.toTagged(TENANT, INSPECTION);
        expect(back.locationOptions).toContain('101');
        const data = await readData(testDb);
        expect(Object.keys(data)).toEqual(['_default:kitchen:sink']);
        const defect = (data['_default:kitchen:sink'] as { tabs: { defects: { location?: string }[] } }).tabs.defects[0];
        expect(defect.location).toBe('101');
        expect(await readMode(testDb)).toBe('tagged');
    });

    it('throws NotFound for an inspection in another tenant', async () => {
        await seed(testDb, { locationOptions: ['101'] });
        await expect(switchSvc.toPerUnit('other-tenant', INSPECTION)).rejects.toThrow();
    });
});
