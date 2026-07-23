/**
 * IA-33 (boundary A) — getReportData spreads the whole inspections row into
 * data.inspection, and GET /api/public/report/:tenant/:id returns that data
 * verbatim to any holder of the link (incl. agent-kind tokens). The row
 * carries `internal_notes` (inspector's private notes) and `price_cents`
 * (commercial pricing), which the account track explicitly withholds from
 * agents at the schema layer. The public report track must not expose them
 * just because the current SSR page happens not to render them.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InspectionService } from '../../../server/services/inspection.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = 'aa000000-0000-0000-0000-000000000001';
const INSPECTION = 'cc000000-0000-0000-0000-000000000003';

describe('getReportData — public field projection (IA-33 boundary A)', () => {
    let svc: InspectionService;
    let testDb: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        svc = new InspectionService({} as D1Database);
        await testDb.insert(schema.tenants).values({
            id: TENANT, name: 'Acme', slug: 'acme', status: 'active',
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
