/**
 * A held deposit becoming an invoice payment — and, just as load-bearing, NOT
 * becoming one when it should stay held.
 *
 * Under GAAP a customer deposit is a liability until the work is delivered, so
 * it lives against the ORDER with a null `invoice_id`. This is the one moment
 * it moves, and three things have to be true afterwards or money appears in one
 * place and not another:
 *
 *  1. The invoice's cached `amount_paid_cents` reflects it. That column has
 *     exactly one writer, and backfilling rows underneath it without calling
 *     that writer is how a cache and a ledger drift apart for three weeks.
 *  2. The REPORT STAYS LOCKED. $90 against $450 is partial, and a deposit is a
 *     scheduling instrument, not the thing that releases a report. This is the
 *     assertion the whole feature is one bug away from failing.
 *  3. The held total goes to ZERO — which is also what the QBO Books health
 *     card counts, so the "not yet synced to QuickBooks" figure must fall by
 *     one when a deposit is applied. A count that only ever grows is a count
 *     nobody trusts.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import { recordPayment, getHeldDepositCents } from '../../../server/services/payment-ledger.service';
import { applyHeldDepositsToInvoice } from '../../../server/services/invoice/deposit-application';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
// eslint-disable-next-line import/order
import { InvoiceService } from '../../../server/services/invoice.service';

const TENANT = '00000000-0000-0000-0000-0000000000a1';
const INSPECTION = 'insp-0000-0000-0000-0000000000a1';

let db: BetterSQLite3Database<typeof schema>;
let invoices: InvoiceService;

beforeEach(async () => {
    const fixture = createTestDb();
    db = fixture.db;
    await setupSchema(fixture.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    invoices = new InvoiceService({} as D1Database);

    await db.insert(schema.tenants).values({
        id: TENANT, name: 'Acme', slug: 'acme', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await db.insert(schema.tenantConfigs).values({ tenantId: TENANT, updatedAt: new Date() });
    await db.insert(schema.inspections).values({
        id: INSPECTION, tenantId: TENANT, propertyAddress: '1 Oak St',
        date: '2026-07-17', createdAt: new Date(),
        depositRequiredCents: 9000,
    });
});

const payDeposit = (amountCents = 9000, providerRef = 'pi_dep') =>
    recordPayment(db, TENANT, {
        inspectionId: INSPECTION, invoiceId: null, kind: 'deposit',
        amountCents, method: 'card', provider: 'stripe', providerRef,
    });

const createInvoiceFor = (amountCents: number) =>
    invoices.createInvoice(TENANT, {
        inspectionId: INSPECTION,
        clientName: 'Dana Buyer',
        amountCents,
        lineItems: [{ description: 'Inspection', amountCents }],
    });

const invoiceRow = (id: string) =>
    db.select().from(schema.invoices).where(eq(schema.invoices.id, id)).get();

const rowsFor = (invoiceId: string) =>
    db.select().from(schema.orderPayments)
        .where(and(eq(schema.orderPayments.tenantId, TENANT), eq(schema.orderPayments.invoiceId, invoiceId)))
        .all();

/**
 * What the QBO Books health card counts, by the same predicate it uses:
 * `order_payments` rows with a null `invoice_id` (qbo/connection.ts).
 */
const heldDepositCount = async () =>
    (await db.select().from(schema.orderPayments)
        .where(and(eq(schema.orderPayments.tenantId, TENANT), isNull(schema.orderPayments.invoiceId)))
        .all()).length;

describe('applying a held deposit when the invoice is created', () => {
    it('moves the row onto the invoice and refreshes the invoice cache', async () => {
        await payDeposit();
        const inv = await createInvoiceFor(45000);

        const attached = await rowsFor(inv.id);
        expect(attached).toHaveLength(1);
        expect(attached[0]).toMatchObject({ kind: 'deposit', amountCents: 9000 });

        // Returned by createInvoice — the hand-built row it used to answer with
        // carried neither of these, so a caller read `undefined` and reported a
        // deposit-bearing invoice as having received nothing.
        expect(inv.amountPaidCents).toBe(9000);
        expect(inv.partialPaidAt).not.toBeNull();

        const stored = await invoiceRow(inv.id);
        expect(stored!.amountPaidCents).toBe(9000);
        expect(stored!.partialPaidAt).not.toBeNull();
        expect(stored!.paidAt).toBeNull();
    });

    it('LEAVES THE REPORT GATED — a deposit is not payment in full', async () => {
        await db.update(schema.inspections).set({ paymentStatus: 'paid' })
            .where(eq(schema.inspections.id, INSPECTION));
        await payDeposit();
        await createInvoiceFor(45000);

        const insp = await db.select().from(schema.inspections)
            .where(eq(schema.inspections.id, INSPECTION)).get();
        // $90 against $450. If this ever reads 'paid', the deposit has become a
        // way to read a report for a fifth of the money.
        expect(insp!.paymentStatus).toBe('unpaid');
    });

    it('decrements the held-deposit count the QBO health card reports', async () => {
        await payDeposit();
        expect(await heldDepositCount()).toBe(1);
        expect(await getHeldDepositCents(db, TENANT, INSPECTION)).toBe(9000);

        await createInvoiceFor(45000);

        expect(await heldDepositCount()).toBe(0);
        expect(await getHeldDepositCents(db, TENANT, INSPECTION)).toBe(0);
    });

    it('does not double-apply to a second invoice on the same order', async () => {
        await payDeposit();
        const first = await createInvoiceFor(45000);
        const second = await createInvoiceFor(5000);

        expect(await rowsFor(first.id)).toHaveLength(1);
        expect(await rowsFor(second.id)).toHaveLength(0);
        expect(second.amountPaidCents).toBe(0);
    });

    it('marks the invoice paid when the deposit covers it outright', async () => {
        // A $90 deposit against a $90 invoice IS paid in full, and refusing to
        // say so would leave a settled job looking outstanding forever.
        await payDeposit();
        const inv = await createInvoiceFor(9000);
        const stored = await invoiceRow(inv.id);
        expect(stored!.paidAt).not.toBeNull();
        expect(stored!.amountPaidCents).toBe(9000);
    });

    it('costs one read and changes nothing when no deposit was taken', async () => {
        const inv = await createInvoiceFor(45000);
        expect(await rowsFor(inv.id)).toHaveLength(0);
        expect(inv.amountPaidCents).toBe(0);
        expect(inv.partialPaidAt).toBeNull();
        const stored = await invoiceRow(inv.id);
        // NULL in the column, 0 in the return, and the difference is deliberate:
        // the ledger has NO OPINION about this invoice, which is not the same as
        // "nothing was paid" — that distinction is what stops the cache writer
        // zeroing an invoice paid before the ledger existed. A brand-new invoice
        // has genuinely received nothing, so 0 is the honest answer to a caller.
        expect(stored!.amountPaidCents).toBeNull();
    });

    it('leaves a standalone invoice alone — there is no order to sweep', async () => {
        await payDeposit();
        const inv = await invoices.createInvoice(TENANT, {
            inspectionId: null, clientName: 'Walk-in', amountCents: 20000,
            lineItems: [{ description: 'Consultation', amountCents: 20000 }],
        });
        expect(await rowsFor(inv.id)).toHaveLength(0);
        expect(await getHeldDepositCents(db, TENANT, INSPECTION)).toBe(9000);
    });

    it('is idempotent called twice against the same invoice', async () => {
        await payDeposit();
        const inv = await createInvoiceFor(45000);
        const moved = await applyHeldDepositsToInvoice(db, TENANT, inv.id, INSPECTION);
        expect(moved).toBe(0);
        expect(await rowsFor(inv.id)).toHaveLength(1);
    });
});
