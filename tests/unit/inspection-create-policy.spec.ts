import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InspectionService } from '../../server/services/inspection.service';
import { ScopedDB } from '../../server/lib/db/scoped';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-0000000000aa';

/**
 * Round-2 backlog #10 — verify InspectionService.createInspection inherits
 * the per-tenant block-report policy (`tenant_configs.block_unpaid` /
 * `block_unsigned_agreement`) when the caller does not supply explicit
 * `paymentRequired` / `agreementRequired` values.
 *
 * Per-inspection override remains the source of truth: when the caller
 * passes `paymentRequired: false`, the row stores `false` even if the
 * tenant policy says "block".
 */
describe('InspectionService.createInspection — Round-2 #10 policy inheritance', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let sdb: ScopedDB;

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        await setupSchema(fixture.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sdb = new ScopedDB(testDb as any, TENANT);

        await testDb.insert(schema.tenants).values({
            id: TENANT,
            name: 'Acme',
            slug: 'acme',
            status: 'active',
            deploymentMode: 'shared',
            tier: 'free',
            createdAt: new Date(),
        });
    });

    it('paymentRequired defaults to true when tenant blockUnpaid is true', async () => {
        await testDb.insert(schema.tenantConfigs).values({
            tenantId: TENANT,
            blockUnpaid: true,
            blockUnsignedAgreement: false,
            updatedAt: new Date(),
        });

        const svc = new InspectionService({} as D1Database, undefined, sdb);
        await svc.createInspection(TENANT, {
            propertyAddress: '1 Main St',
            clientName: 'Test Client',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);

        const row = await testDb.select().from(schema.inspections).get();
        expect(row?.paymentRequired).toBe(true);
        expect(row?.agreementRequired).toBe(false);
    });

    it('agreementRequired defaults to true when tenant blockUnsignedAgreement is true', async () => {
        await testDb.insert(schema.tenantConfigs).values({
            tenantId: TENANT,
            blockUnpaid: false,
            blockUnsignedAgreement: true,
            updatedAt: new Date(),
        });

        const svc = new InspectionService({} as D1Database, undefined, sdb);
        await svc.createInspection(TENANT, {
            propertyAddress: '2 Main St',
            clientName: 'Test Client',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);

        const row = await testDb.select().from(schema.inspections).get();
        expect(row?.paymentRequired).toBe(false);
        expect(row?.agreementRequired).toBe(true);
    });

    it('explicit paymentRequired: false overrides tenant policy', async () => {
        await testDb.insert(schema.tenantConfigs).values({
            tenantId: TENANT,
            blockUnpaid: true,
            blockUnsignedAgreement: true,
            updatedAt: new Date(),
        });

        const svc = new InspectionService({} as D1Database, undefined, sdb);
        await svc.createInspection(TENANT, {
            propertyAddress: '3 Main St',
            clientName: 'Test Client',
            paymentRequired: false,
            agreementRequired: false,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);

        const row = await testDb.select().from(schema.inspections).get();
        expect(row?.paymentRequired).toBe(false);
        expect(row?.agreementRequired).toBe(false);
    });

    it('both flags default to false when tenant has no tenant_configs row', async () => {
        // No tenantConfigs insert — the createInspection lookup must tolerate
        // a missing row and fall back to false on both flags.
        const svc = new InspectionService({} as D1Database, undefined, sdb);
        await svc.createInspection(TENANT, {
            propertyAddress: '4 Main St',
            clientName: 'Test Client',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);

        const row = await testDb.select().from(schema.inspections).get();
        expect(row?.paymentRequired).toBe(false);
        expect(row?.agreementRequired).toBe(false);
    });
});
