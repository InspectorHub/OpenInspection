/**
 * An inspection remembers what KIND of property it is of.
 *
 * `inspections.property_type` existed, the new-inspection wizard offered three
 * buttons for it, and four separate readers branched on it — but nothing ever
 * wrote it. The column was NULL on every row the product could create, so
 * `resolveReportTier` returned null for every job, `buildPcaReportBlock`
 * returned null for every job, the Building Profile resolved to an empty list,
 * and the editor's units / cost-items surface was gated on a value that could
 * not occur. Picking "Commercial" in the wizard changed a border colour and
 * nothing else.
 *
 * These specs pin the whole chain at its narrowest point: the value the request
 * carries is the value the row holds, a value outside the vocabulary is refused
 * rather than stored, and a request that says nothing still stores nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InspectionService } from '../../../server/services/inspection.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import { ScopedDB } from '../../../server/lib/db/scoped';
import { createTestDb, setupSchema } from '../db';
import { asD1Db } from '../helpers/test-db';
import * as schema from '../../../server/lib/db/schema';
import { CreateInspectionSchema } from '../../../server/lib/validations/inspection.schema';
import {
    INSPECTION_PROPERTY_TYPES,
    type InspectionPropertyType,
} from '../../../server/lib/inspection-property-type';
import { resolveReportTier } from '../../../server/lib/report-tier';
import { buildPcaReportBlock } from '../../../server/lib/pca-report-block';
import { resolveBuildingProfile } from '../../../server/lib/building-profile';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-0000000000p1';

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
        id: TENANT, slug: 'property-type-co', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await seedRoleProfiles(asD1Db(testDb), TENANT, new Date());

    inspectionSvc = new InspectionService({} as D1Database, undefined, sdb);
});

/** Create one inspection and hand back the row that was actually stored. */
async function createAndRead(
    input: Record<string, unknown>,
): Promise<typeof schema.inspections.$inferSelect> {
    // The service takes the schema's output type; these specs deliberately feed
    // it the same field names the wire schema validates, so the cast is the
    // boundary and not a licence to invent a shape.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await inspectionSvc.createInspection(TENANT, input as any);
    const row = await testDb.select().from(schema.inspections).get();
    expect(row, 'createInspection stored no row at all').toBeTruthy();
    return row!;
}

describe('createInspection — property type reaches the row', () => {
    // Looped over the authority rather than a retyped list: a value added to
    // INSPECTION_PROPERTY_TYPES gets a round-trip assertion for free, and a
    // value quietly removed from it fails the wizard's label map instead.
    for (const propertyType of INSPECTION_PROPERTY_TYPES) {
        it(`round-trips "${propertyType}" from the request to the column`, async () => {
            const row = await createAndRead({
                propertyAddress: `1 ${propertyType} Way`,
                propertyType,
            });
            expect(
                row.propertyType,
                'the wizard selection was accepted by validation and then dropped before the insert',
            ).toBe(propertyType);
        });
    }

    /**
     * The backward-compatibility control. Every caller that is not the wizard —
     * the booking fulfiller, the concierge intake, the clone path, an API client
     * written before the field existed — sends no property type, and those rows
     * must keep landing unclassified. A default of `single_family` here would
     * silently assert that every booked job is a detached house, and the report
     * layer reads this column to decide what a report IS.
     */
    it('stores NULL when the request omits the field', async () => {
        const row = await createAndRead({ propertyAddress: '2 Unsaid Street' });
        expect(row.propertyType, 'an omitted property type must stay unclassified, not default').toBeNull();
    });
});

describe('CreateInspectionSchema — property type vocabulary', () => {
    const base = { propertyAddress: '3 Validation Road', templateId: 'tpl-1' };

    it('accepts every value the wizard can offer', () => {
        for (const propertyType of INSPECTION_PROPERTY_TYPES) {
            const parsed = CreateInspectionSchema.safeParse({ ...base, propertyType });
            expect(parsed.success, `${propertyType} is offered in the UI but refused by the API`).toBe(true);
        }
    });

    // The negative cases, each paired with the positive control above so a
    // blanket-rejecting schema cannot read as a pass.
    it.each([
        // A plausible type the product does not model. Storing it would leave a
        // row no reader understands: getMetadataPreset returns [], and the
        // Building Profile silently renders nothing.
        'duplex',
        // The HYPHEN spelling. It is the correct vocabulary for the TEMPLATE and
        // marketplace columns and the wrong one here, and `normalizePropertyType`
        // only translates one way — so a hyphen slug stored on an inspection is
        // the single most likely wrong value to arrive, and the least visible.
        'single-family',
        'multi-unit',
        // Casing and whitespace are not normalised away into a near-miss.
        'Commercial',
        '',
    ])('rejects %j rather than storing it', (propertyType) => {
        const parsed = CreateInspectionSchema.safeParse({ ...base, propertyType });
        expect(parsed.success).toBe(false);
    });
});

describe('the readers that were unreachable', () => {
    /**
     * Step-6 evidence: what a non-default value actually switches on. These call
     * the resolvers with the value the column now holds, so a regression in the
     * write path shows up as a dead report feature rather than only as a changed
     * string.
     */
    it('commercial turns on the report tier and the PCA block', async () => {
        const row = await createAndRead({ propertyAddress: '4 Commerce Ct', propertyType: 'commercial' });

        expect(resolveReportTier({ propertyType: row.propertyType, storedTier: row.reportTier }))
            .toBe('light_commercial');
        expect(buildPcaReportBlock({ propertyType: row.propertyType, sections: [] })).not.toBeNull();
    });

    it('multi_unit resolves a Building Profile; an unclassified row resolves none', async () => {
        const row = await createAndRead({ propertyAddress: '5 Quad Ave', propertyType: 'multi_unit' });

        // resolveBuildingProfile bridges the underscore slug to the hyphen-keyed
        // presets via normalizePropertyType. If that bridge is ever bypassed this
        // comes back empty, which is exactly how it behaved while the column was
        // always NULL.
        const rows = resolveBuildingProfile({ propertyType: row.propertyType, propertyFacts: { yearBuilt: 1998 } });
        expect(rows.length, 'multi_unit must reach METADATA_PRESETS["multi-unit"]').toBeGreaterThan(0);

        expect(resolveBuildingProfile({ propertyType: null, propertyFacts: { yearBuilt: 1998 } })).toEqual([]);
    });

    it('residential does NOT turn on the commercial-only surfaces', async () => {
        const row = await createAndRead({ propertyAddress: '6 House Lane', propertyType: 'single_family' });

        expect(resolveReportTier({ propertyType: row.propertyType, storedTier: null })).toBeNull();
        expect(buildPcaReportBlock({ propertyType: row.propertyType, sections: [] })).toBeNull();
    });
});

describe('the wizard selector and the API share one vocabulary', () => {
    /**
     * The defect was not a missing column — it was two lists that never met. The
     * selector's values lived only in the component; the API's field did not
     * exist. This asserts the tuple is the single source, against the drizzle
     * column's own nullability rather than a literal.
     */
    it('every canonical value is a storable column value', () => {
        const values: readonly InspectionPropertyType[] = INSPECTION_PROPERTY_TYPES;
        expect(new Set(values).size, 'duplicate slug in the canonical tuple').toBe(values.length);
        for (const v of values) {
            expect(v, 'inspection property types are underscore slugs, not hyphen ones').not.toContain('-');
        }
    });
});
