/**
 * A commercial PCA publishes its cost opinion; a residential report does not.
 *
 * ── WHY THE TWO DIFFER, AND WHY ONE GLOBAL FLAG WAS WRONG ───────────────────
 * `showEstimates` was pinned `false` for every report, with a reason that is
 * only true of RESIDENTIAL work: repair prices belong to the contractor, not to
 * the inspector. That is the industry's position too — InterNACHI's Standards
 * of Practice do not require an inspector to give correction, replacement or
 * repair cost estimates, and ASHI bars inspectors from the repair business
 * outright to keep the inspection disinterested.
 *
 * A Property Condition Assessment is the opposite case. ASTM E2018's Property
 * Condition Report carries Opinions of Probable Costs for the deficiencies it
 * finds, in the three statutory buckets (Immediate, Short-Term, Long-Term), and
 * a lender reads exactly that: an immediate-repair table and a replacement
 * reserve table are what capital reserves get underwritten from and what a loan
 * gets conditioned on. A `full_pca` report with no cost opinion is not a PCA a
 * lender would accept — the table is the reason the report exists.
 *
 * The export buttons are NOT the answer to this. What a lender relies on is the
 * signed report naming them, not a spreadsheet somebody downloaded beside it.
 *
 * ── WHAT THIS DOES NOT UNLOCK ───────────────────────────────────────────────
 * The per-FINDING price badge stays gone, and its own gate
 * (`scripts/check-price-capability.mjs`) still fails if a price-shaped column
 * reappears on a finding. That capability and this one draw from different
 * places: the badge from a price on the defect row, this from the PCA cost-item
 * tables. Unlocking one says nothing about the other, which is precisely the
 * distinction the single global flag had collapsed.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import { InspectionService } from '../../../server/services/inspection.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-000000000099';
const TEMPLATE_ID = '22222222-2222-2222-2222-222222222222';

const TEMPLATE_SCHEMA = {
    schemaVersion: 2,
    sections: [
        { id: 'roof', title: 'Roof', items: [{ id: 'roof-shingles', label: 'Shingles' }] },
    ],
};

/** One inspection, differing only in the field under test. */
async function seedInspection(
    testDb: BetterSQLite3Database<typeof schema>,
    id: string,
    over: Partial<typeof schema.inspections.$inferInsert>,
) {
    await testDb.insert(schema.inspections).values({
        id,
        tenantId: TENANT,
        templateId: TEMPLATE_ID,
        templateSnapshot: TEMPLATE_SCHEMA,
        propertyAddress: '500 Commerce Way',
        date: '2026-06-01',
        status: 'completed',
        paymentStatus: 'paid',
        price: 0,
        paymentRequired: false,
        agreementRequired: false,
        createdAt: new Date(),
        ...over,
    });
}

describe('cost visibility follows the report tier', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let svc: InspectionService;

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        await setupSchema(fixture.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        svc = new InspectionService({} as D1Database);
        await testDb.insert(schema.tenants).values({
            id: TENANT, slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await testDb.insert(schema.templates).values({
            id: TEMPLATE_ID, tenantId: TENANT, name: 'Standard',
            schema: TEMPLATE_SCHEMA, version: 1, createdAt: new Date(),
        });
    });

    it('publishes the cost opinion on a full PCA', async () => {
        const id = '11111111-1111-1111-1111-11111111aaaa';
        await seedInspection(testDb, id, { propertyType: 'commercial', reportTier: 'full_pca' });
        const report = await svc.getReportData(id, TENANT);
        expect(report.showEstimates).toBe(true);
    });

    /**
     * POSITIVE CONTROL. A flag flipped to `true` unconditionally would satisfy
     * the case above, and would put a price in front of every residential
     * client — the outcome the pin existed to prevent.
     */
    it('withholds it on a residential report', async () => {
        const id = '11111111-1111-1111-1111-11111111bbbb';
        await seedInspection(testDb, id, { propertyType: 'residential', reportTier: null });
        const report = await svc.getReportData(id, TENANT);
        expect(report.showEstimates).toBe(false);
    });

    /**
     * SECOND POSITIVE CONTROL, and not a redundant one: "commercial" is not the
     * predicate. `light_commercial` is a walk-through, not an E2018 baseline
     * PCA, and it carries no obligation to opine on cost — so a gate keyed on
     * `propertyType === 'commercial'` would be wrong here while still passing
     * both cases above.
     */
    it('withholds it on a light commercial report, which is not a PCA', async () => {
        const id = '11111111-1111-1111-1111-11111111cccc';
        await seedInspection(testDb, id, { propertyType: 'commercial', reportTier: 'light_commercial' });
        const report = await svc.getReportData(id, TENANT);
        expect(report.showEstimates).toBe(false);
    });
});
