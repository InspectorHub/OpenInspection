import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InspectionService } from '../../../server/services/inspection.service';
import { ServiceService } from '../../../server/services/service.service';
import { ScopedDB } from '../../../server/lib/db/scoped';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const T1 = 'aaaaaaaa-0000-0000-0000-000000000001';
const DC_ID = 'dddddddd-0000-0000-0000-000000000001';

/**
 * Task 10 (#180) — atomic discount redemption.
 *
 * (a) redeemDiscountCode with max_uses=1, uses_count=0 → returns true, uses_count becomes 1.
 * (b) same code now at cap (uses_count=1, max_uses=1) → returns false, uses_count stays 1.
 * (c) createInspection with a capped discountCodeId → inspection IS created,
 *     but discountAmount=0 and discountCodeId=null (discount dropped).
 * (d) createInspection with an under-cap code → inspection created,
 *     uses_count incremented, discount retained.
 */
describe('discount redemption — redeemDiscountCode + createInspection gate', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sdb: ScopedDB;

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        await setupSchema(fixture.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(db);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sdb = new ScopedDB(db as any, T1);

        await db.insert(schema.tenants).values({
            id: T1,
            name: 'Acme',
            slug: 'acme',
            status: 'active',
            deploymentMode: 'shared',
            tier: 'free',
            createdAt: new Date(),
        });
    });

    async function seedCode(opts: { usesCount: number; maxUses: number | null }) {
        await db.insert(schema.discountCodes).values({
            id: DC_ID,
            tenantId: T1,
            code: 'TEST10',
            type: 'fixed',
            value: 1000,
            maxUses: opts.maxUses,
            usesCount: opts.usesCount,
            active: true,
            createdAt: new Date(),
        });
    }

    // (a) under-cap: redeem returns true, uses_count incremented
    it('(a) redeemDiscountCode returns true when uses_count < max_uses', async () => {
        await seedCode({ usesCount: 0, maxUses: 1 });

        const svc = new ServiceService({} as D1Database);
        const result = await svc.redeemDiscountCode(T1, DC_ID);

        expect(result).toBe(true);

        const row = await db.select().from(schema.discountCodes).get();
        expect(row?.usesCount).toBe(1);
    });

    // (b) at cap: redeem returns false, uses_count unchanged
    it('(b) redeemDiscountCode returns false when at cap (uses_count >= max_uses)', async () => {
        await seedCode({ usesCount: 1, maxUses: 1 });

        const svc = new ServiceService({} as D1Database);
        const result = await svc.redeemDiscountCode(T1, DC_ID);

        expect(result).toBe(false);

        const row = await db.select().from(schema.discountCodes).get();
        expect(row?.usesCount).toBe(1); // unchanged
    });

    // (c) createInspection with capped code → inspection created, discount dropped
    it('(c) createInspection with capped code creates inspection without discount', async () => {
        await seedCode({ usesCount: 1, maxUses: 1 });

        const insSvc = new InspectionService({} as D1Database, undefined, sdb);
        const created = await insSvc.createInspection(T1, {
            propertyAddress: '10 Oak Ave',
            clientName: 'Test Client',
            discountCodeId: DC_ID,
            discountAmount: 1000,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);

        // Inspection should be created successfully
        expect(created).toBeDefined();
        expect(created.propertyAddress).toBe('10 Oak Ave');

        // Discount should be dropped on the persisted row
        const row = await db.select().from(schema.inspections).get();
        expect(row?.discountCodeId).toBeNull();
        expect(row?.discountAmount).toBe(0);

        // uses_count should NOT have incremented (cap blocked redemption)
        const dcRow = await db.select().from(schema.discountCodes).get();
        expect(dcRow?.usesCount).toBe(1);
    });

    // (d) createInspection with under-cap code → discount retained, uses_count incremented
    it('(d) createInspection with under-cap code retains discount and increments uses_count', async () => {
        await seedCode({ usesCount: 0, maxUses: 5 });

        const insSvc = new InspectionService({} as D1Database, undefined, sdb);
        const created = await insSvc.createInspection(T1, {
            propertyAddress: '20 Elm St',
            clientName: 'Test Client',
            discountCodeId: DC_ID,
            discountAmount: 1000,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);

        expect(created).toBeDefined();

        // Discount should be retained on the persisted row
        const row = await db.select().from(schema.inspections).get();
        expect(row?.discountCodeId).toBe(DC_ID);
        expect(row?.discountAmount).toBe(1000);

        // uses_count should have incremented
        const dcRow = await db.select().from(schema.discountCodes).get();
        expect(dcRow?.usesCount).toBe(1);
    });
});
