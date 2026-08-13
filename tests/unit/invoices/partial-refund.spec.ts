/**
 * `refundPartial` — the writer that did not exist.
 *
 * `markRefunded` reverses everything received and `correctPayment` is
 * explicitly not a refund, so nothing could return 22500 of 45000 and leave the
 * rest retained. Two properties carry the weight:
 *
 *  - it RETURNS the appended row. An external book of record keys its credit
 *    memo on that row id, because `qbo_entity_map` holds one memo per
 *    (tenant, type, oiId) forever and keying on the invoice makes a second
 *    refund throw inside the push — memo in QuickBooks, map row lost.
 *  - it re-syncs the report gate. A refund can take an invoice out of paid, and
 *    a report left publicly readable with no backing payment is the failure the
 *    gate exists to prevent.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { refundPartial } from '../../../server/services/invoice/refund';
import { recordPayment, getNetReceivedCents } from '../../../server/services/payment-ledger.service';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';

const TENANT = '00000000-0000-0000-0000-000000000001';
const INSP = 'i-1';
const INV = 'inv-1';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

describe('refundPartial', () => {
    let testDb: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        await testDb.insert(schema.tenants).values({
            id: TENANT, slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await testDb.insert(schema.inspections).values({
            id: INSP, tenantId: TENANT, propertyAddress: '1 St', date: '2026-08-10',
            status: 'scheduled', paymentStatus: 'paid', price: 45000,
            agreementRequired: false, paymentRequired: true, createdAt: new Date(),
        });
        await testDb.insert(schema.invoices).values({
            id: INV, tenantId: TENANT, inspectionId: INSP, amountCents: 45000,
            lineItems: [{ description: 'Inspection', amountCents: 45000 }], createdAt: new Date(),
        } as never);
    });

    async function collect(amountCents: number) {
        await recordPayment(testDb as AnyDb, TENANT, {
            invoiceId: INV, inspectionId: INSP, kind: 'balance', amountCents, method: 'card',
        });
    }

    async function ledger() {
        return testDb.select().from(schema.orderPayments)
            .where(eq(schema.orderPayments.invoiceId, INV)).all();
    }

    async function paymentStatus() {
        const row = await testDb.select({ p: schema.inspections.paymentStatus })
            .from(schema.inspections).where(eq(schema.inspections.id, INSP)).get();
        return row!.p;
    }

    it('appends exactly one refund row and leaves the receipt standing', async () => {
        await collect(45000);
        await refundPartial(testDb as AnyDb, TENANT, INV, { amountCents: 22500, reason: 'Cancellation' });

        const rows = await ledger();
        expect(rows.filter(r => r.kind === 'refund')).toHaveLength(1);
        expect(rows.filter(r => r.kind === 'balance')).toHaveLength(1);
        expect(rows.find(r => r.kind === 'refund')!.amountCents).toBe(22500);
        expect(await getNetReceivedCents(testDb as AnyDb, TENANT, INV)).toBe(22500);
    });

    it('returns the appended row so a credit memo can be keyed on it', async () => {
        await collect(45000);
        const appended = await refundPartial(testDb as AnyDb, TENANT, INV, { amountCents: 10000, reason: 'x' });
        expect(appended.id).toEqual(expect.any(String));
        expect(appended).toMatchObject({ kind: 'refund', amountCents: 10000 });

        const rows = await ledger();
        expect(rows.find(r => r.id === appended.id)).toBeDefined();
    });

    it('gives each refund its own row identity, so a second one is pushable', async () => {
        await collect(45000);
        const first = await refundPartial(testDb as AnyDb, TENANT, INV, { amountCents: 10000, reason: 'a' });
        const second = await refundPartial(testDb as AnyDb, TENANT, INV, { amountCents: 5000, reason: 'b' });
        expect(second.id).not.toBe(first.id);
        expect(await getNetReceivedCents(testDb as AnyDb, TENANT, INV)).toBe(30000);
    });

    it('re-syncs the report gate when the refund takes the invoice out of paid', async () => {
        await collect(45000);
        expect(await paymentStatus()).toBe('paid');
        await refundPartial(testDb as AnyDb, TENANT, INV, { amountCents: 22500, reason: 'Cancellation' });
        expect(await paymentStatus()).toBe('unpaid');
    });

    it('refuses to refund more than has been received', async () => {
        await collect(9000);
        await expect(refundPartial(testDb as AnyDb, TENANT, INV, { amountCents: 22500, reason: 'x' }))
            .rejects.toThrow(/larger than what has been received/i);
        expect((await ledger()).filter(r => r.kind === 'refund')).toHaveLength(0);
    });

    it('refuses a zero or negative refund', async () => {
        await collect(9000);
        await expect(refundPartial(testDb as AnyDb, TENANT, INV, { amountCents: 0, reason: 'x' }))
            .rejects.toThrow(/positive whole number/i);
        await expect(refundPartial(testDb as AnyDb, TENANT, INV, { amountCents: -100, reason: 'x' }))
            .rejects.toThrow(/positive whole number/i);
    });

    it('can reverse an invoice paid before the ledger existed', async () => {
        // No ledger rows at all, only the invoice's own paid record. Without
        // the seed the received figure reads zero and every refund is refused.
        await testDb.update(schema.invoices).set({ paidAt: new Date() })
            .where(eq(schema.invoices.id, INV));
        const appended = await refundPartial(testDb as AnyDb, TENANT, INV, { amountCents: 5000, reason: 'x' });
        expect(appended.amountCents).toBe(5000);
        expect(await getNetReceivedCents(testDb as AnyDb, TENANT, INV)).toBe(40000);
    });

    it('will not touch an invoice belonging to another tenant', async () => {
        await collect(45000);
        await expect(refundPartial(testDb as AnyDb, 'other-tenant', INV, { amountCents: 100, reason: 'x' }))
            .rejects.toThrow(/not found/i);
    });
});
