/**
 * The hub's lifecycle facts: whether money has been collected (the cancellation quote's
 * figure, so ledger payments count, not only the order flag) and the recorded status of a
 * cancelled job. A yes/no and a status, never an amount.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import { asD1Db } from '../helpers/test-db';
import * as schema from '../../../server/lib/db/schema';
import { hubLifecycle } from '../../../server/lib/inspection/hub-lifecycle';
import { recordPayment } from '../../../server/services/payment-ledger.service';

const T = '00000000-0000-0000-0000-000000000001';
let db: BetterSQLite3Database<typeof schema>;

const life = (id: string, status = 'scheduled', paymentStatus = 'unpaid') => hubLifecycle(asD1Db(db), T, { id, status, paymentStatus });

beforeEach(async () => {
    const fix = createTestDb();
    db = fix.db as BetterSQLite3Database<typeof schema>;
    await setupSchema(fix.sqlite);
    const now = new Date();
    await db.insert(schema.tenants).values({ id: T, slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: now });
    await db.insert(schema.tenantConfigs).values({ tenantId: T, updatedAt: now });
    await db.insert(schema.inspections).values([
        { id: 'free', tenantId: T, propertyAddress: '1 St', date: '2099-08-07', status: 'scheduled', paymentStatus: 'unpaid', price: 45000, createdAt: now },
        { id: 'ledger', tenantId: T, propertyAddress: '2 St', date: '2099-08-07', status: 'scheduled', paymentStatus: 'unpaid', price: 45000, createdAt: now },
    ]);
    await db.insert(schema.invoices).values({
        id: 'inv-1', tenantId: T, inspectionId: 'ledger', amountCents: 45000,
        lineItems: [{ description: 'Inspection', amountCents: 45000 }], createdAt: now,
    } as never);
    await recordPayment(db as never, T, {
        invoiceId: 'inv-1', inspectionId: 'ledger', kind: 'balance', amountCents: 45000, method: 'card', provider: 'stripe', providerRef: 'pi_1',
    });
});

describe('hubLifecycle', () => {
    it('says no money for a job with no payment, and yes for the order flag or for a ledger payment under an unpaid flag', async () => {
        expect((await life('free')).moneyCollected).toBe(false);
        expect((await life('free', 'scheduled', 'paid')).moneyCollected).toBe(true);
        expect((await life('ledger')).moneyCollected).toBe(true);
    });

    it('returns the recorded status of a cancelled job, and null for a live one or an unrecorded cancellation', async () => {
        expect((await life('free', 'cancelled')).statusBeforeCancel).toBeNull();
        await db.insert(schema.auditLogs).values({
            id: 'a1', tenantId: T, userId: 'u', action: 'inspection.status_change', entityType: 'inspection', entityId: 'free',
            metadata: { from: 'confirmed', to: 'cancelled' }, createdAt: new Date(),
        } as typeof schema.auditLogs.$inferInsert);
        expect((await life('free', 'cancelled')).statusBeforeCancel).toBe('confirmed');
        // Control: the same row, once restored, is not asked.
        expect((await life('free', 'scheduled')).statusBeforeCancel).toBeNull();
    });

    it('carries no amount', async () => {
        expect(Object.keys(await life('ledger')).sort()).toEqual(['moneyCollected', 'statusBeforeCancel']);
    });
});
