import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InspectionService } from '../../../server/services/inspection.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq, and } from 'drizzle-orm';
import { INSPECTION_STATUS } from '../../../server/lib/status/inspection-status';
import { REPORT_STATUS } from '../../../server/lib/status/report-status';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-000000000001';

/** Helper: returns the current report_status + status for an inspection row. */
async function readStatuses(db: BetterSQLite3Database<typeof schema>, id: string) {
    const row = await db.select({
        status:       schema.inspections.status,
        reportStatus: schema.inspections.reportStatus,
    }).from(schema.inspections)
        .where(eq(schema.inspections.id, id))
        .get();
    if (!row) throw new Error(`inspection ${id} not found`);
    return row;
}

function makeInspection(overrides: Partial<typeof schema.inspections.$inferInsert> & { id: string }) {
    return {
        tenantId:          TENANT,
        propertyAddress:   '1 Main St',
        clientName:        'Test Client',
        clientEmail:       'test@example.com',
        date:              '2026-06-01',
        status:            INSPECTION_STATUS.COMPLETED,
        reportStatus:      REPORT_STATUS.IN_PROGRESS,
        paymentStatus:     'unpaid',
        price:             0,
        paymentRequired:   false,
        agreementRequired: false,
        createdAt:         new Date(),
        ...overrides,
    } satisfies typeof schema.inspections.$inferInsert;
}

describe('Report review workflow (submit / publish / return / unpublish)', () => {
    let svc: InspectionService;
    let testDb: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        await setupSchema(fixture.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        svc = new InspectionService({} as D1Database);

        await testDb.insert(schema.tenants).values([
            { id: TENANT, name: 'Acme', slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        ]);
    });

    // ─── publishInspection ────────────────────────────────────────────────────

    it('1. publish sets reportStatus=PUBLISHED and leaves status=COMPLETED', async () => {
        await testDb.insert(schema.inspections).values([
            makeInspection({ id: 'insp-pub-1', status: INSPECTION_STATUS.COMPLETED, reportStatus: REPORT_STATUS.IN_PROGRESS }),
        ]);

        await svc.publishInspection('insp-pub-1', TENANT, {
            theme: 'default', notifyClient: false, notifyAgent: false,
            requireSignature: false, requirePayment: false,
        });

        const row = await readStatuses(testDb, 'insp-pub-1');
        expect(row.reportStatus).toBe(REPORT_STATUS.PUBLISHED);
        expect(row.status).toBe(INSPECTION_STATUS.COMPLETED);
    });

    it('2. publish throws when inspection status !== completed (e.g. scheduled)', async () => {
        await testDb.insert(schema.inspections).values([
            makeInspection({ id: 'insp-pub-2', status: INSPECTION_STATUS.SCHEDULED }),
        ]);

        await expect(
            svc.publishInspection('insp-pub-2', TENANT, {
                theme: 'default', notifyClient: false, notifyAgent: false,
                requireSignature: false, requirePayment: false,
            })
        ).rejects.toThrow(/must be completed/i);
    });

    it('6. re-publish an already-published completed inspection stays published', async () => {
        await testDb.insert(schema.inspections).values([
            makeInspection({ id: 'insp-pub-6', status: INSPECTION_STATUS.COMPLETED, reportStatus: REPORT_STATUS.PUBLISHED }),
        ]);

        // Should NOT throw — re-publishing an already-published report is idempotent
        await svc.publishInspection('insp-pub-6', TENANT, {
            theme: 'default', notifyClient: false, notifyAgent: false,
            requireSignature: false, requirePayment: false,
        });

        const row = await readStatuses(testDb, 'insp-pub-6');
        expect(row.reportStatus).toBe(REPORT_STATUS.PUBLISHED);
        expect(row.status).toBe(INSPECTION_STATUS.COMPLETED);
    });

    // ─── submitReport ─────────────────────────────────────────────────────────

    it('3. submitReport transitions in_progress → submitted (completed inspection)', async () => {
        await testDb.insert(schema.inspections).values([
            makeInspection({ id: 'insp-sub-1', status: INSPECTION_STATUS.COMPLETED, reportStatus: REPORT_STATUS.IN_PROGRESS }),
        ]);

        await svc.submitReport('insp-sub-1', TENANT);

        const row = await readStatuses(testDb, 'insp-sub-1');
        expect(row.reportStatus).toBe(REPORT_STATUS.SUBMITTED);
        expect(row.status).toBe(INSPECTION_STATUS.COMPLETED);
    });

    it('submitReport throws when inspection status !== completed (e.g. scheduled)', async () => {
        await testDb.insert(schema.inspections).values([
            makeInspection({ id: 'insp-sub-2', status: INSPECTION_STATUS.SCHEDULED }),
        ]);

        await expect(svc.submitReport('insp-sub-2', TENANT))
            .rejects.toThrow(/must be completed/i);
    });

    it('submitReport throws when reportStatus is not in_progress (e.g. already submitted)', async () => {
        await testDb.insert(schema.inspections).values([
            makeInspection({ id: 'insp-sub-3', status: INSPECTION_STATUS.COMPLETED, reportStatus: REPORT_STATUS.SUBMITTED }),
        ]);

        await expect(svc.submitReport('insp-sub-3', TENANT))
            .rejects.toThrow(/cannot submit/i);
    });

    // ─── returnReport ─────────────────────────────────────────────────────────

    it('4. returnReport transitions submitted → in_progress', async () => {
        await testDb.insert(schema.inspections).values([
            makeInspection({ id: 'insp-ret-1', status: INSPECTION_STATUS.COMPLETED, reportStatus: REPORT_STATUS.SUBMITTED }),
        ]);

        await svc.returnReport('insp-ret-1', TENANT);

        const row = await readStatuses(testDb, 'insp-ret-1');
        expect(row.reportStatus).toBe(REPORT_STATUS.IN_PROGRESS);
    });

    it('returnReport throws when reportStatus !== submitted', async () => {
        await testDb.insert(schema.inspections).values([
            makeInspection({ id: 'insp-ret-2', status: INSPECTION_STATUS.COMPLETED, reportStatus: REPORT_STATUS.IN_PROGRESS }),
        ]);

        await expect(svc.returnReport('insp-ret-2', TENANT))
            .rejects.toThrow(/only submitted/i);
    });

    // ─── unpublishReport ──────────────────────────────────────────────────────

    it('5. unpublishReport transitions published → in_progress', async () => {
        await testDb.insert(schema.inspections).values([
            makeInspection({ id: 'insp-unp-1', status: INSPECTION_STATUS.COMPLETED, reportStatus: REPORT_STATUS.PUBLISHED }),
        ]);

        await svc.unpublishReport('insp-unp-1', TENANT);

        const row = await readStatuses(testDb, 'insp-unp-1');
        expect(row.reportStatus).toBe(REPORT_STATUS.IN_PROGRESS);
    });

    it('unpublishReport throws when reportStatus !== published', async () => {
        await testDb.insert(schema.inspections).values([
            makeInspection({ id: 'insp-unp-2', status: INSPECTION_STATUS.COMPLETED, reportStatus: REPORT_STATUS.SUBMITTED }),
        ]);

        await expect(svc.unpublishReport('insp-unp-2', TENANT))
            .rejects.toThrow(/only published/i);
    });
});
