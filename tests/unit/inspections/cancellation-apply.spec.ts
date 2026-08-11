/**
 * Applying the cancellation ladder end to end: quote the outcome, then record
 * the fee and the refund as ledger rows and NOTHING else.
 *
 * The assertion that matters most is not the arithmetic — Task 2's spec covers
 * that without a database. It is that the money lands as ledger rows, that the
 * retained fee is what the invoice ends up showing as received, and that the
 * report's payment gate comes back down. A refund that leaves
 * `inspections.payment_status = 'paid'` hands out a report with no payment
 * behind it, and no test that only reads `order_payments` can see it.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { quoteCancellation, applyCancellationRefund } from '../../../server/services/inspection/cancellation.service';
import { recordPayment, getNetReceivedCents } from '../../../server/services/payment-ledger.service';
import type { CancellationPolicy } from '../../../server/lib/billing/cancellation-policy';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';

const TENANT = '00000000-0000-0000-0000-000000000001';
const INSP = 'i-1';
const INV = 'inv-1';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

const NOW = new Date(Date.UTC(2026, 7, 6, 12, 0, 0));
const IN_12H = new Date(NOW.getTime() + 12 * 3_600_000);
const IN_48H = new Date(NOW.getTime() + 48 * 3_600_000);

const POLICY: CancellationPolicy = {
    noticeHours: 24,
    lateFee: { type: 'percent', percent: 50 },
    noShowFee: { type: 'percent', percent: 100 },
    remedy: 'refund',
};

describe('cancellation — quote and apply', () => {
    let testDb: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        await testDb.insert(schema.tenants).values({
            id: TENANT, slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
    });

    async function seed(opts: {
        policy?: CancellationPolicy | null;
        scheduledStartMs?: Date | null;
        collectCents?: number;
        method?: 'card' | 'check';
        provider?: 'stripe' | null;
    } = {}) {
        await testDb.insert(schema.tenantConfigs).values({
            tenantId: TENANT, updatedAt: new Date(),
            cancellationPolicy: opts.policy === undefined ? POLICY : opts.policy,
        } as never);
        await testDb.insert(schema.inspections).values({
            id: INSP, tenantId: TENANT, propertyAddress: '1 St', date: '2026-08-07',
            status: 'confirmed', paymentStatus: 'paid', price: 45000,
            scheduledStartMs: opts.scheduledStartMs === undefined ? IN_12H : opts.scheduledStartMs,
            agreementRequired: false, paymentRequired: true, createdAt: new Date(),
        } as never);
        await testDb.insert(schema.invoices).values({
            id: INV, tenantId: TENANT, inspectionId: INSP, amountCents: 45000,
            lineItems: [{ description: 'Inspection', amountCents: 45000 }], createdAt: new Date(),
        } as never);
        const collect = opts.collectCents ?? 45000;
        if (collect > 0) {
            await recordPayment(testDb as AnyDb, TENANT, {
                invoiceId: INV, inspectionId: INSP, kind: 'balance', amountCents: collect,
                method: opts.method ?? 'card',
                provider: opts.provider === undefined ? 'stripe' : opts.provider,
                providerRef: opts.provider === null ? null : 'pi_1',
            });
        }
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

    it('records the fee and the refund as ledger rows, and nothing else', async () => {
        await seed();
        const quote = await quoteCancellation(testDb as AnyDb, TENANT, INSP, 'client_cancelled', NOW);
        expect(quote.outcome).toMatchObject({ feeCents: 22500, refundCents: 22500, reason: 'late_cancellation' });

        await applyCancellationRefund(testDb as AnyDb, TENANT, quote, null);

        const rows = await ledger();
        expect(rows.filter(r => r.kind === 'refund')).toHaveLength(1);
        expect(rows.find(r => r.kind === 'refund')!.amountCents).toBe(22500);
        expect(rows).toHaveLength(2);
        // The retained fee, read back off the ledger rather than asserted twice.
        expect(await getNetReceivedCents(testDb as AnyDb, TENANT, INV)).toBe(22500);
    });

    it('takes the report gate back down when the refund unpays the invoice', async () => {
        await seed();
        expect(await paymentStatus()).toBe('paid');
        const quote = await quoteCancellation(testDb as AnyDb, TENANT, INSP, 'client_cancelled', NOW);
        await applyCancellationRefund(testDb as AnyDb, TENANT, quote, null);
        expect(await paymentStatus()).toBe('unpaid');
    });

    it('refunds everything and keeps nothing when the inspector cancels late', async () => {
        await seed();
        const quote = await quoteCancellation(testDb as AnyDb, TENANT, INSP, 'inspector_unavailable', NOW);
        expect(quote.outcome).toMatchObject({ feeCents: 0, refundCents: 45000, reason: 'inspector_initiated' });
        await applyCancellationRefund(testDb as AnyDb, TENANT, quote, null);
        expect(await getNetReceivedCents(testDb as AnyDb, TENANT, INV)).toBe(0);
    });

    it('classifies a no-show off the recorded reason, without a second column', async () => {
        await seed({ scheduledStartMs: new Date(NOW.getTime() - 24 * 3_600_000) });
        const quote = await quoteCancellation(testDb as AnyDb, TENANT, INSP, 'no_show', NOW);
        expect(quote.outcome).toMatchObject({ feeCents: 45000, refundCents: 0, reason: 'no_show' });
        expect(await applyCancellationRefund(testDb as AnyDb, TENANT, quote, null)).toBeNull();
        expect((await ledger()).filter(r => r.kind === 'refund')).toHaveLength(0);
    });

    it('appends nothing at all when the workspace has no policy', async () => {
        await seed({ policy: null });
        const quote = await quoteCancellation(testDb as AnyDb, TENANT, INSP, 'client_cancelled', NOW);
        expect(quote.policyConfigured).toBe(false);
        expect(quote.outcome).toMatchObject({ feeCents: 0, refundCents: 45000, reason: 'no_policy' });
        await applyCancellationRefund(testDb as AnyDb, TENANT, quote, null);
        // A full refund is still a refund: it IS recorded, because the money
        // going back is a fact. What is not recorded is a fee.
        expect((await ledger()).filter(r => r.kind === 'refund')).toHaveLength(1);
        expect(await getNetReceivedCents(testDb as AnyDb, TENANT, INV)).toBe(0);
    });

    it('charges only what was collected against a deposit, not a share of the price', async () => {
        await seed({ collectCents: 9000 });
        const quote = await quoteCancellation(testDb as AnyDb, TENANT, INSP, 'client_cancelled', NOW);
        // 50% of the 45000 PRICE is 22500; only 9000 came in, so 9000 is kept.
        expect(quote).toMatchObject({ priceCents: 45000, paidCents: 9000 });
        expect(quote.outcome).toMatchObject({ feeCents: 9000, refundCents: 0, cappedAtCollected: true });
        expect(await applyCancellationRefund(testDb as AnyDb, TENANT, quote, null)).toBeNull();
    });

    it('charges nothing with sufficient notice', async () => {
        await seed({ scheduledStartMs: IN_48H });
        const quote = await quoteCancellation(testDb as AnyDb, TENANT, INSP, 'client_cancelled', NOW);
        expect(quote.outcome).toMatchObject({ feeCents: 0, reason: 'sufficient_notice' });
    });

    it('charges nothing when the order has no precise scheduled instant', async () => {
        await seed({ scheduledStartMs: null });
        const quote = await quoteCancellation(testDb as AnyDb, TENANT, INSP, 'client_cancelled', NOW);
        expect(quote.outcome).toMatchObject({ feeCents: 0, reason: 'no_scheduled_instant' });
    });

    it('quotes the processing fee Stripe keeps, and only for card money', async () => {
        await seed();
        const card = await quoteCancellation(testDb as AnyDb, TENANT, INSP, 'client_cancelled', NOW);
        // 2.9% + 30c of the ORIGINAL 45000 charge, not of the 22500 refunded.
        expect(card.retainedProcessingFeeCents).toBe(1335);
    });

    it('quotes no processing fee against money that never went through Stripe', async () => {
        await seed({ method: 'check', provider: null });
        const cheque = await quoteCancellation(testDb as AnyDb, TENANT, INSP, 'client_cancelled', NOW);
        expect(cheque.outcome.refundCents).toBe(22500);
        expect(cheque.retainedProcessingFeeCents).toBe(0);
    });

    it('quotes without writing anything', async () => {
        await seed();
        const before = await ledger();
        await quoteCancellation(testDb as AnyDb, TENANT, INSP, 'no_show', NOW);
        expect(await ledger()).toHaveLength(before.length);
        expect(await paymentStatus()).toBe('paid');
    });

    it('will not quote an inspection belonging to another tenant', async () => {
        await seed();
        await expect(quoteCancellation(testDb as AnyDb, 'other-tenant', INSP, 'client_cancelled', NOW))
            .rejects.toThrow(/not found/i);
    });
});
