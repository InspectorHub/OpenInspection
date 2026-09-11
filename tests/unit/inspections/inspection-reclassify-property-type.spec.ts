/**
 * An inspection can be reclassified after intake — and reclassifying tells the
 * truth about what it costs.
 *
 * `propertyType` was writable only at creation. That left two holes: a wrong pick
 * in the wizard was permanent, and every inspection created before intake
 * captured the field at all could never reach the commercial surface, which is
 * the larger half of any existing deployment. Its two siblings
 * (`commercial_subtype`, `report_tier`) were always editable through the
 * property-facts strip; this column was the one omission.
 *
 * The direction that matters is commercial → residential, because four readers
 * branch on this column and all four close at once. What these specs pin is that
 * closing them DESTROYS NOTHING: no cascade runs, the unit rows / cost lines /
 * narrative all stay exactly where they were, and setting the type back restores
 * every reader. That is the property the UI warning is allowed to promise.
 *
 * Exercises the REAL mounted PATCH route (RBAC + zod + handler) against in-memory
 * SQLite, mirroring inspection-patch-settings.spec.ts.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { OpenAPIHono } from '@hono/zod-openapi';
import { inspectionsRoutes } from '../../../server/api/inspections';
import { InspectionService } from '../../../server/services/inspection.service';
import type { HonoConfig } from '../../../server/types/hono';
import { UpdateInspectionSchema } from '../../../server/lib/validations/inspection.schema';
import { INSPECTION_PROPERTY_TYPES } from '../../../server/lib/inspection-property-type';
import { resolveReportTier } from '../../../server/lib/report-tier';
import { buildPcaReportBlock } from '../../../server/lib/pca-report-block';
import { resolveBuildingProfile } from '../../../server/lib/building-profile';

const TENANT = '00000000-0000-0000-0000-000000000001';
const USER_ID = '00000000-0000-0000-0000-000000000300';
const INSP_ID = '550e8400-e29b-41d4-a716-446655440000';

let db: BetterSQLite3Database<typeof schema>;

function buildApp(role = 'manager') {
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('userRole', role as never);
        c.set('tenantId', TENANT);
        c.set('user', { sub: USER_ID } as never);
        const realSvc = new InspectionService({} as D1Database);
        c.set(
            'services',
            { inspection: {
                getInspection: vi.fn().mockResolvedValue({ inspection: { status: 'requested' } }),
                isInspectionPhotoKey: (i: string, t: string, k: string) => realSvc.isInspectionPhotoKey(i, t, k),
            } } as never,
        );
        await next();
    });
    app.route('/api/inspections', inspectionsRoutes);
    return app;
}

async function patch(body: unknown, role = 'manager'): Promise<number> {
    const res = await buildApp(role).request(
        `/api/inspections/${INSP_ID}`,
        { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
        { DB: {} },
    );
    return res.status;
}

function row() {
    return db.select().from(schema.inspections).where(eq(schema.inspections.id, INSP_ID)).get();
}

/** Everything an inspector can only have entered while the job was commercial. */
async function seedCommercialWork() {
    await db.update(schema.inspections).set({
        propertyType: 'commercial',
        commercialSubtype: 'office',
        reportTier: 'full_pca',
        unitInspectionMode: 'per_unit',
        pcaNarrative: { purpose: 'ASTM E2018 PCA for the lender.' },
        deviations: [{ id: 'd1', area: 'Roof', baselineRequirement: 'walk', deviation: 'viewed from grade', reason: 'no access' }],
    }).where(eq(schema.inspections.id, INSP_ID));

    await db.insert(schema.inspectionUnits).values([
        { id: 'unit-1', tenantId: TENANT, inspectionId: INSP_ID, kind: 'unit', type: 'unit', name: 'Suite 100', sortOrder: 0, createdAt: new Date() },
        { id: 'unit-2', tenantId: TENANT, inspectionId: INSP_ID, kind: 'unit', type: 'unit', name: 'Suite 200', sortOrder: 1, createdAt: new Date() },
    ] as never);

    await db.insert(schema.costItems).values([
        {
            id: 'cost-1', tenantId: TENANT, inspectionId: INSP_ID,
            system: 'roof', component: 'Membrane', location: '', action: 'replace',
            costMethod: 'lump_sum', lumpSumCents: 4_500_000, bucket: 'short_term',
            suggestedRemedy: '', sortOrder: 0, createdAt: new Date(),
        },
        {
            id: 'cost-2', tenantId: TENANT, inspectionId: INSP_ID,
            system: 'mep', component: 'RTU-3', location: '', action: 'repair',
            costMethod: 'unit', quantity: 2, unitCostCents: 180_000, bucket: 'immediate',
            suggestedRemedy: '', sortOrder: 1, createdAt: new Date(),
        },
    ] as never);
}

beforeEach(async () => {
    const fixture = createTestDb();
    db = fixture.db;
    await setupSchema(fixture.sqlite);
    await db.insert(schema.tenants).values({
        id: TENANT, slug: 'reclass-co', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await db.insert(schema.inspections).values({
        id: INSP_ID, tenantId: TENANT,
        propertyAddress: '1 Reclassify Way',
        date: '2026-06-01', status: 'requested', paymentStatus: 'unpaid', price: 50000,
        agreementRequired: false, paymentRequired: false, createdAt: new Date(),
    });
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
});

describe('PATCH /api/inspections/:id — residential → commercial', () => {
    it('writes the column and opens every commercial reader', async () => {
        // The pre-fix state of EVERY row in an existing deployment.
        expect((await row())!.propertyType).toBeNull();
        expect(resolveReportTier({ propertyType: null, storedTier: null })).toBeNull();

        expect(await patch({ propertyType: 'commercial' })).toBe(200);

        const after = (await row())!;
        expect(after.propertyType, 'the only post-intake route to the commercial surface').toBe('commercial');
        expect(resolveReportTier({ propertyType: after.propertyType, storedTier: after.reportTier })).toBe('light_commercial');
        expect(buildPcaReportBlock({ propertyType: after.propertyType, sections: [] })).not.toBeNull();
    });

    it('reaches multi_unit too, with the Building Profile preset the bridge resolves', async () => {
        expect(await patch({ propertyType: 'multi_unit' })).toBe(200);

        const after = (await row())!;
        expect(after.propertyType).toBe('multi_unit');
        expect(resolveBuildingProfile({ propertyType: after.propertyType, propertyFacts: { yearBuilt: 1998 } }).length)
            .toBeGreaterThan(0);
    });

    it('clears the classification when sent null', async () => {
        await patch({ propertyType: 'commercial' });
        // Asserted BEFORE the clear: without it this test also passes on a build
        // that ignores the field entirely, because the row starts out null.
        expect((await row())!.propertyType).toBe('commercial');

        expect(await patch({ propertyType: null })).toBe(200);
        expect((await row())!.propertyType, 'null is how a mis-classification is undone').toBeNull();
    });
});

describe('PATCH /api/inspections/:id — commercial → residential', () => {
    beforeEach(seedCommercialWork);

    it('closes the commercial readers', async () => {
        expect(await patch({ propertyType: 'single_family' })).toBe(200);

        const after = (await row())!;
        expect(after.propertyType).toBe('single_family');
        expect(resolveReportTier({ propertyType: after.propertyType, storedTier: after.reportTier })).toBeNull();
        expect(buildPcaReportBlock({
            propertyType: after.propertyType,
            pcaNarrative: after.pcaNarrative,
            deviations: after.deviations,
            sections: [],
        }), 'the PCA block must not print on a residential report').toBeNull();
    });

    /**
     * The promise the confirmation modal makes, asserted rather than assumed. If a
     * cascade is ever added to this path these break, which is the point: a
     * warning that says "nothing is deleted" must be checkable.
     */
    it('deletes NOTHING — unit rows, cost lines and narrative all survive', async () => {
        await patch({ propertyType: 'single_family' });

        const units = await db.select().from(schema.inspectionUnits)
            .where(eq(schema.inspectionUnits.inspectionId, INSP_ID)).all();
        const costs = await db.select().from(schema.costItems)
            .where(eq(schema.costItems.inspectionId, INSP_ID)).all();
        expect(units, 'reclassifying must not delete unit rows').toHaveLength(2);
        expect(costs, 'reclassifying must not delete opinion-of-cost lines').toHaveLength(2);

        const after = (await row())!;
        expect(after.commercialSubtype, 'the subtype is hidden, not cleared').toBe('office');
        expect(after.reportTier, 'the tier is hidden, not cleared').toBe('full_pca');
        expect(after.pcaNarrative).toEqual({ purpose: 'ASTM E2018 PCA for the lender.' });
        expect(after.deviations).toHaveLength(1);
    });

    /**
     * What I found in step 3, pinned so the UI copy cannot quietly become a lie:
     * the report's per-unit payload is gated on `unit_inspection_mode`, a DIFFERENT
     * column that reclassifying does not touch. So per-unit findings keep printing
     * while the editor's unit switcher (gated on propertyType === 'commercial')
     * closes. The asymmetry is why the modal has a second heading.
     */
    it('leaves unit_inspection_mode alone, so the report keeps printing units', async () => {
        await patch({ propertyType: 'single_family' });

        const after = (await row())!;
        expect(
            after.unitInspectionMode,
            'if this ever flips to tagged, the report loses unit data the user was told it would keep',
        ).toBe('per_unit');
    });

    it('is reversible — setting it back restores every reader', async () => {
        await patch({ propertyType: 'single_family' });
        // The readers must actually be CLOSED here, or "reversible" is vacuous —
        // a build that ignores the field passes the round trip without moving.
        const mid = (await row())!;
        expect(resolveReportTier({ propertyType: mid.propertyType, storedTier: mid.reportTier })).toBeNull();

        expect(await patch({ propertyType: 'commercial' })).toBe(200);

        const after = (await row())!;
        expect(resolveReportTier({ propertyType: after.propertyType, storedTier: after.reportTier })).toBe('full_pca');
        expect(buildPcaReportBlock({ propertyType: after.propertyType, sections: [] })).not.toBeNull();
        const costs = await db.select().from(schema.costItems)
            .where(eq(schema.costItems.inspectionId, INSP_ID)).all();
        expect(costs, 'the cost lines come back because they never left').toHaveLength(2);
    });
});

describe('UpdateInspectionSchema — reclassification vocabulary', () => {
    it('accepts every canonical value and null', () => {
        for (const propertyType of INSPECTION_PROPERTY_TYPES) {
            expect(UpdateInspectionSchema.safeParse({ propertyType }).success, propertyType).toBe(true);
        }
        expect(UpdateInspectionSchema.safeParse({ propertyType: null }).success).toBe(true);
    });

    // The hyphen forms are the template/marketplace vocabulary and would store a
    // value no inspection reader understands; the rest are plausible near-misses.
    it.each(['single-family', 'multi-unit', 'duplex', 'Commercial', ''])(
        'rejects %j rather than storing it',
        (propertyType) => {
            expect(UpdateInspectionSchema.safeParse({ propertyType }).success).toBe(false);
        },
    );

    it('refuses the whole patch rather than dropping the bad field', async () => {
        await patch({ propertyType: 'commercial' });
        expect(await patch({ propertyType: 'duplex', county: 'Travis' })).toBe(400);
        const after = (await row())!;
        expect(after.propertyType, 'a rejected patch must change nothing').toBe('commercial');
        expect(after.county).toBeNull();
    });
});
