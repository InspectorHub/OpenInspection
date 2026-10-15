/**
 * InspectionAnalyticsService — voided invoice exclusion from analytics signals.
 *
 * Spec: voided invoices are excluded from all readers.
 *
 * Covers the analytics query path that must ignore voided invoices:
 * overdueSet feeds the needsAttention bucket — a voided unpaid past-due invoice
 * must NOT put its inspection into needsAttention.
 *
 * Task TDD: RED (before isNull(voidedAt) predicate) → GREEN (after fix).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InspectionAnalyticsService } from '../../../server/services/inspection/inspection-analytics.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

const TENANT = '00000000-0000-0000-0000-000000000099';
const INSP_A  = 'i-void-analytics-a';
const INSP_B  = 'i-void-analytics-b';

/**
 * Minimal stub for the InspectionService facade parameter.
 * getDashboardBuckets does not call back into the facade, so an empty object suffices.
 */
const facadeStub = {} as unknown as import('../../../server/services/inspection.service').InspectionService;

describe('InspectionAnalyticsService — voided invoice exclusion', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let svc: InspectionAnalyticsService;

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        const { drizzle } = await import('drizzle-orm/d1');
        (drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        svc = new InspectionAnalyticsService(
            {} as D1Database,
            undefined,
            undefined,
            undefined,
            undefined,
            facadeStub,
        );

        await testDb.insert(schema.tenants).values({
            id: TENANT, slug: 'voidanalyticsco',
            status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });

        // Inspection A — used for the paid tests. reportStatus 'published' so it
        // lands deterministically in the decorated `recentReports` bucket
        // (completed + published), independent of the current date. Without an
        // explicit published status it only appeared in the date-relative `today`
        // bucket, making the assertions silently date-dependent.
        await testDb.insert(schema.inspections).values({
            id: INSP_A, tenantId: TENANT, propertyAddress: '10 Void Ave',
            date: '2026-06-22', status: 'completed', reportStatus: 'published', paymentStatus: 'paid',
            price: 0, agreementRequired: false, paymentRequired: true, createdAt: new Date(),
        });

        // Inspection B — used for the overdue+voided test; scheduled far in
        // the future so it won't trigger the 48h-upcoming needsAttention clause.
        await testDb.insert(schema.inspections).values({
            id: INSP_B, tenantId: TENANT, propertyAddress: '11 Void Blvd',
            date: '2030-01-01', status: 'scheduled', paymentStatus: 'unpaid',
            price: 0, agreementRequired: false, paymentRequired: true, createdAt: new Date(),
        });
    });

    it('voided unpaid past-due invoice does NOT put the inspection in needsAttention (discriminating: would be true without isNull(voidedAt))', async () => {
        // Seed an unpaid invoice with a past due date AND voidedAt set.
        // dueDate 30 days ago — well past any overdue threshold (default 72h).
        const pastDue = new Date(Date.now() - 30 * 24 * 3600 * 1000);
        const pastDueStr = pastDue.toISOString().slice(0, 10); // YYYY-MM-DD

        await testDb.insert(schema.invoices).values({
            id: 'inv-overdue-voided', tenantId: TENANT, inspectionId: INSP_B,
            amountCents: 40000,
            lineItems: [{ description: 'Inspection', amountCents: 40000 }],
            dueDate:  pastDueStr,
            voidedAt: new Date(Date.now() - 1 * 24 * 3600 * 1000),
            createdAt: new Date(),
        } as never);

        const result = await svc.getDashboardBuckets(TENANT);

        const row = result.needsAttention.find(r => r.id === INSP_B);
        expect(row).toBeUndefined();
    });

    it('non-voided unpaid past-due invoice DOES put the inspection in needsAttention (baseline sanity)', async () => {
        const pastDue = new Date(Date.now() - 30 * 24 * 3600 * 1000);
        const pastDueStr = pastDue.toISOString().slice(0, 10);

        await testDb.insert(schema.invoices).values({
            id: 'inv-overdue-live', tenantId: TENANT, inspectionId: INSP_B,
            amountCents: 40000,
            lineItems: [{ description: 'Inspection', amountCents: 40000 }],
            dueDate: pastDueStr,
            createdAt: new Date(),
        } as never);

        const result = await svc.getDashboardBuckets(TENANT);

        const row = result.needsAttention.find(r => r.id === INSP_B);
        // A real overdue invoice must flag the row — confirms the predicate didn't break the happy path.
        expect(row).toBeDefined();
    });
});
