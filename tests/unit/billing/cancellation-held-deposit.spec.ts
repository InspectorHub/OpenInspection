/**
 * Cancelling a booking whose only money is a HELD DEPOSIT.
 *
 * This is the seam between the cancellation ladder and the deposit, and it is
 * the case the deposit feature exists for: a client no-shows on a job that was
 * never invoiced. Two things have to be true, and they fail in opposite
 * directions:
 *
 *  1. The deposit COUNTS as collected. `resolveCancellation` caps every fee at
 *     `paidCents`, so quoting zero would make a 100% no-show fee charge nothing
 *     and refund nothing — the deposit sits held forever and the feature is
 *     inert exactly where it was supposed to bite.
 *  2. The refund it calls for actually gets WRITTEN. Counting the deposit while
 *     `applyCancellationRefund` still needs an invoice would be worse than
 *     today: the quote would promise a refund and the write would silently do
 *     nothing. `refundHeldDeposit` is the second writer, and these tests are
 *     what stop the pair from shipping half-done.
 *
 * The mixed case — a webhook landing after the invoice was raised, so both
 * pools hold money — drains the INVOICE first. Its `amount_paid_cents` is a
 * number a human reads off a screen, and leaving it overstated while the money
 * came back out of an invisible pool is the same "cash in one place and not the
 * other" failure in miniature.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import { recordPayment, getHeldDepositCents, getNetReceivedCents } from '../../../server/services/payment-ledger.service';
import { quoteCancellation, applyCancellationRefund } from '../../../server/services/inspection/cancellation.service';
import { refundHeldDeposit } from '../../../server/services/invoice/refund';

const TENANT = '00000000-0000-0000-0000-0000000000c1';
const INSPECTION = 'insp-0000-0000-0000-0000000000c1';
const INVOICE = 'inv-0000-0000-0000-0000000000c1';

/** The appointment is 2026-08-20 09:00Z. `NOW` is two hours before it. */
const SCHEDULED = new Date('2026-08-20T09:00:00Z');
const LATE = new Date('2026-08-20T07:00:00Z');
const EARLY = new Date('2026-08-14T09:00:00Z');

/** 24h notice; late cancellation keeps half, a no-show keeps everything. */
const POLICY = {
    noticeHours: 24,
    lateFee: { type: 'percent' as const, percent: 50 },
    noShowFee: { type: 'percent' as const, percent: 100 },
    remedy: 'refund' as const,
};

let db: BetterSQLite3Database<typeof schema>;

beforeEach(async () => {
    const fixture = createTestDb();
    db = fixture.db;
    await setupSchema(fixture.sqlite);

    await db.insert(schema.tenants).values({
        id: TENANT, name: 'Acme', slug: 'acme', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await db.insert(schema.tenantConfigs).values({
        tenantId: TENANT, updatedAt: new Date(), cancellationPolicy: POLICY,
    });
    await db.insert(schema.inspections).values({
        id: INSPECTION, tenantId: TENANT, propertyAddress: '1 Oak St',
        date: '2026-08-20', createdAt: new Date(),
        price: 45000, scheduledStartMs: SCHEDULED,
        depositRequiredCents: 9000,
    });
});

const payDeposit = (amountCents = 9000, providerRef = 'pi_dep') =>
    recordPayment(db, TENANT, {
        inspectionId: INSPECTION, invoiceId: null, kind: 'deposit',
        amountCents, method: 'card', provider: 'stripe', providerRef,
    });

async function seedInvoice(amountCents = 45000, receivedCents = 0) {
    await db.insert(schema.invoices).values({
        id: INVOICE, tenantId: TENANT, inspectionId: INSPECTION, amountCents,
        lineItems: [{ description: 'Inspection', amountCents }],
        createdAt: new Date(), currency: 'USD',
    });
    if (receivedCents > 0) {
        await recordPayment(db, TENANT, {
            inspectionId: INSPECTION, invoiceId: INVOICE, kind: 'balance',
            amountCents: receivedCents, method: 'card', provider: 'stripe', providerRef: 'pi_bal',
        });
    }
}

const heldRefundRows = () =>
    db.select().from(schema.orderPayments)
        .where(and(
            eq(schema.orderPayments.tenantId, TENANT),
            eq(schema.orderPayments.kind, 'refund'),
            isNull(schema.orderPayments.invoiceId),
        ))
        .all();

describe('a held deposit is money collected, and the ladder must see it', () => {
    it('counts toward paidCents when the order has no invoice at all', async () => {
        await payDeposit();
        const quote = await quoteCancellation(db, TENANT, INSPECTION, 'client_cancelled', LATE);
        expect(quote.invoiceId).toBeNull();
        expect(quote.paidCents).toBe(9000);
        expect(quote.heldDepositCents).toBe(9000);
    });

    it('lets a no-show actually cost the client the deposit', async () => {
        // The reason the feature exists. With paidCents at 0 this would charge
        // nothing, refund nothing, and leave the money held with nobody told.
        await payDeposit();
        const quote = await quoteCancellation(db, TENANT, INSPECTION, 'no_show', LATE);
        expect(quote.outcome.feeCents).toBe(9000);
        expect(quote.outcome.refundCents).toBe(0);
        // The ladder wanted 100% of $450 and could only keep the $90 collected.
        // Surfacing that is the point: the tenant is owed less than their policy
        // says and should learn it here, not in a reconciliation.
        expect(quote.outcome.cappedAtCollected).toBe(true);
    });

    it('gives the deposit back in full when the client cancels in time', async () => {
        await payDeposit();
        const quote = await quoteCancellation(db, TENANT, INSPECTION, 'client_cancelled', EARLY);
        expect(quote.outcome.reason).toBe('sufficient_notice');
        expect(quote.outcome.refundCents).toBe(9000);
    });

    it('quotes the retained Stripe fee even though no invoice was ever raised', async () => {
        // Scoped to the ORDER: the deposit is the most likely card payment on a
        // job cancelled before invoicing, and an invoice-scoped lookup would
        // quote a zero processing loss on exactly that cancellation.
        await payDeposit();
        const quote = await quoteCancellation(db, TENANT, INSPECTION, 'client_cancelled', EARLY);
        expect(quote.retainedProcessingFeeCents).toBeGreaterThan(0);
    });
});

describe('the refund is actually written, with no invoice to write it against', () => {
    it('appends an invoice-less refund row and empties the held pool', async () => {
        await payDeposit();
        const quote = await quoteCancellation(db, TENANT, INSPECTION, 'client_cancelled', EARLY);
        const row = await applyCancellationRefund(db, TENANT, quote, 'user-1');

        expect(row).not.toBeNull();
        expect(row!.row.kind).toBe('refund');
        expect(row!.row.amountCents).toBe(9000);
        // NULL, and the cancel route reads it as "do not post this to
        // QuickBooks": the deposit was never pushed there, so a credit memo
        // would credit the customer for revenue QuickBooks never recorded.
        expect(row!.invoiceId).toBeNull();

        const refunds = await heldRefundRows();
        expect(refunds).toHaveLength(1);
        expect(refunds[0].inspectionId).toBe(INSPECTION);
        expect(refunds[0].invoiceId).toBeNull();

        // Receipts minus refunds: nothing is held any more.
        expect(await getHeldDepositCents(db, TENANT, INSPECTION)).toBe(0);
    });

    it('keeps the retained fee and refunds only the rest on a late cancellation', async () => {
        await payDeposit();
        const quote = await quoteCancellation(db, TENANT, INSPECTION, 'client_cancelled', LATE);
        expect(quote.outcome.feeCents).toBe(9000);   // 50% of $450, capped at the $90 collected
        expect(quote.outcome.refundCents).toBe(0);
        expect(await applyCancellationRefund(db, TENANT, quote, null)).toBeNull();
        expect(await getHeldDepositCents(db, TENANT, INSPECTION)).toBe(9000);
    });

    it('refuses to send back more than is held', async () => {
        await payDeposit(9000);
        await expect(
            refundHeldDeposit(db, TENANT, INSPECTION, { amountCents: 15000, reason: 'oops' }),
        ).rejects.toThrow(/larger than the deposit still held/);
    });

    it('refuses a zero or negative refund', async () => {
        await payDeposit();
        await expect(
            refundHeldDeposit(db, TENANT, INSPECTION, { amountCents: 0, reason: 'oops' }),
        ).rejects.toThrow(/positive whole number/);
    });
});

describe('when both pools hold money, the invoice is drained first', () => {
    it('splits the refund across the two writers', async () => {
        // A deposit webhook that landed after the invoice was raised: $90 held,
        // $200 received on the invoice, and an inspector-initiated cancellation
        // that refunds everything.
        await seedInvoice(45000, 20000);
        await payDeposit();

        const quote = await quoteCancellation(db, TENANT, INSPECTION, 'inspector_cancelled', LATE);
        expect(quote.paidCents).toBe(29000);
        expect(quote.heldDepositCents).toBe(9000);
        expect(quote.outcome.refundCents).toBe(29000);

        await applyCancellationRefund(db, TENANT, quote, null);

        // The invoice's own cache is square — that is the number a human reads.
        expect(await getNetReceivedCents(db, TENANT, INVOICE)).toBe(0);
        // And the invisible pool is square too.
        expect(await getHeldDepositCents(db, TENANT, INSPECTION)).toBe(0);
        expect(await heldRefundRows()).toHaveLength(1);
    });

    it('takes nothing from the held pool when the invoice covers the refund', async () => {
        await seedInvoice(45000, 20000);
        await payDeposit();

        const quote = await quoteCancellation(db, TENANT, INSPECTION, 'client_cancelled', LATE);
        // 50% of $450 = $225 fee, capped at the $290 collected → $65 back, all
        // of which the invoice can cover on its own.
        expect(quote.outcome.refundCents).toBe(6500);
        await applyCancellationRefund(db, TENANT, quote, null);

        expect(await getNetReceivedCents(db, TENANT, INVOICE)).toBe(13500);
        expect(await getHeldDepositCents(db, TENANT, INSPECTION)).toBe(9000);
        expect(await heldRefundRows()).toHaveLength(0);
    });
});
