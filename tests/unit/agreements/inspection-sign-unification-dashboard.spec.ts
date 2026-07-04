import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { InspectionService } from '../../../server/services/inspection.service';
import { ScopedDB } from '../../../server/lib/db/scoped';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

/**
 * Track I-a Task 5 — signedByClient + dashboard truth read from the agreement
 * envelope (no legacy inspection_agreements row). Companion to
 * inspection-sign-unification.spec; split into its own file so each describe
 * builds its OWN isolated in-memory DB (these run in parallel as separate files).
 */

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

import { TENANT_ID, INSP_ID, AGR_ID } from '../helpers/inspection-sign-unification-setup';

describe('signedByClient + dashboard truth read from the envelope (Track I-a Task 5)', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: any;

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db as BetterSQLite3Database<typeof schema>;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);
        (mockDrizzle as any).mockReturnValue(db);
        await db.insert(schema.tenants).values({
            id: TENANT_ID, name: 'Acme', slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', maxUsers: 5, createdAt: new Date(),
        } as any);
        await db.insert(schema.inspections).values({
            id: INSP_ID, tenantId: TENANT_ID, propertyAddress: '1 Main St', clientName: 'Jane',
            clientEmail: 'jane@test.com', date: '2026-06-01', status: 'requested', paymentStatus: 'unpaid',
            price: 50000, agreementRequired: true, paymentRequired: false, createdAt: new Date(),
        } as any);
        await db.insert(schema.agreements).values({
            id: AGR_ID, tenantId: TENANT_ID, name: 'Standard Agreement',
            content: 'ORIGINAL agreement text', version: 1, createdAt: new Date(),
        } as any);
    });

    afterEach(() => sqlite.close());

    it('getInspection().signedByClient true from a signed envelope (no inspection_agreements row)', async () => {
        await db.insert(schema.agreementRequests).values({
            id: 'req-signed-1', tenantId: TENANT_ID, inspectionId: INSP_ID, agreementId: AGR_ID,
            clientEmail: 'jane@test.com', clientName: 'Jane', token: crypto.randomUUID(),
            status: 'signed', completionPolicy: 'all', createdAt: new Date(),
        } as any);

        const sdb = new ScopedDB(db as never, TENANT_ID);
        const svc = new InspectionService({} as D1Database, undefined, sdb);
        const { inspection } = await svc.getInspection(INSP_ID, TENANT_ID);
        expect(inspection.signedByClient).toBe(true);
    });

    it('getInspection().signedByClient false when only non-signed envelopes exist', async () => {
        await db.insert(schema.agreementRequests).values({
            id: 'req-sent-1', tenantId: TENANT_ID, inspectionId: INSP_ID, agreementId: AGR_ID,
            clientEmail: 'jane@test.com', clientName: 'Jane', token: crypto.randomUUID(),
            status: 'sent', completionPolicy: 'all', createdAt: new Date(),
        } as any);

        const sdb = new ScopedDB(db as never, TENANT_ID);
        const svc = new InspectionService({} as D1Database, undefined, sdb);
        const { inspection } = await svc.getInspection(INSP_ID, TENANT_ID);
        expect(inspection.signedByClient).toBe(false);
    });

    it('dashboard buckets agreementSigned flag reads from signed envelopes', async () => {
        // Date today so the inspection surfaces in the `today` bucket (a signed
        // envelope keeps it OUT of needsAttention, so it must be a dated bucket).
        const todayStr = new Date().toISOString().slice(0, 10);
        await db.update(schema.inspections).set({ date: todayStr, status: 'confirmed' })
            .where(eq(schema.inspections.id, INSP_ID));
        await db.insert(schema.agreementRequests).values({
            id: 'req-signed-2', tenantId: TENANT_ID, inspectionId: INSP_ID, agreementId: AGR_ID,
            clientEmail: 'jane@test.com', clientName: 'Jane', token: crypto.randomUUID(),
            status: 'signed', completionPolicy: 'all', createdAt: new Date(),
        } as any);

        const svc = new InspectionService({} as D1Database);
        const buckets = await svc.getDashboardBuckets(TENANT_ID) as Record<string, any>;
        const all = ['needsAttention', 'today', 'thisWeek', 'later', 'recentReports', 'cancelled']
            .flatMap((k) => (Array.isArray(buckets[k]) ? buckets[k] : []));
        const row = all.find((r: any) => r.id === INSP_ID);
        expect(row).toBeTruthy();
        expect((row as any).statusFlags.agreementSigned).toBe(true);
    });
});
