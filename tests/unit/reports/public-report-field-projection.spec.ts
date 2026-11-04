/**
 * IA-33 (boundary A) — getReportData spreads the whole inspections row into
 * data.inspection. The row carries `internal_notes` (inspector's private notes)
 * and `price_cents` (commercial pricing), which the account track withholds
 * from agents at the schema layer, so the service removes both. The response
 * for a report link is built from field lists (see report-link-response.spec.ts);
 * this spec pins the service-level removal, which stays as a second layer.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { InspectionService } from '../../../server/services/inspection.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import { lazyD1 } from '../helpers/d1-binding';
const testD1 = lazyD1();

const TENANT = 'aa000000-0000-0000-0000-000000000001';
const INSPECTION = 'cc000000-0000-0000-0000-000000000003';

describe('getReportData — public field projection (IA-33 boundary A)', () => {
    let svc: InspectionService;
    let testDb: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        testD1.use(testDb);
        svc = new InspectionService(testD1.binding);
        await testDb.insert(schema.tenants).values({
            id: TENANT, slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await testDb.insert(schema.inspections).values({
            id: INSPECTION, tenantId: TENANT,
            propertyAddress: '1 Main St', date: '2026-06-01',
            status: 'completed', reportStatus: 'published', paymentStatus: 'unpaid',
            price: 45000, internalNotes: 'Client was rude; do not rebook.',
            paymentRequired: false, agreementRequired: false, createdAt: new Date(),
        });
    });

    it('omits internal_notes and price_cents from data.inspection', async () => {
        const data = await svc.getReportData(INSPECTION, TENANT) as unknown as {
            inspection: Record<string, unknown>;
        };
        expect(data.inspection).not.toHaveProperty('internalNotes');
        expect(data.inspection).not.toHaveProperty('price');
        // Non-sensitive fields the report needs still come through.
        expect(data.inspection.propertyAddress).toBe('1 Main St');
        expect(data.inspection).toHaveProperty('date', '2026-06-01');
    });
});
