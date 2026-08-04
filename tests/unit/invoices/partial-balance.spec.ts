/**
 * Partial-payment capture (OI #273, bug half).
 *
 * QuickBooks returns `{ Balance, TotalAmt }` and the invoice sync already
 * decides the 'partial' branch from them — but every adapter dropped the
 * number, so a partially-paid invoice could say THAT something was paid and
 * never HOW MUCH. These specs pin the three things that are easy to get wrong
 * once the amount is actually stored:
 *
 *  1. We persist the amount PAID, never QuickBooks' remaining Balance. Our
 *     `invoices.amountCents` is the authoritative total (money authority
 *     chain), so remaining must be derived against it; storing QBO's Balance
 *     would state a remainder computed against QuickBooks' total, which drifts
 *     the first time either side edits the invoice.
 *  2. QBO speaks dollars. The dollar-to-cent conversion rounds, because a bare
 *     float multiply yields off-by-one-cent balances nobody can explain.
 *  3. Paid-in-full and refunded both clear it, so the amount can never
 *     contradict the status derived from `paidAt` / `partialPaidAt`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { InvoiceService } from '../../../server/services/invoice.service';
import { QBOServiceBase } from '../../../server/services/qbo/api-base';
import { withInvoiceSync } from '../../../server/services/qbo/invoice-sync';
import type { InvoiceSummary } from '../../../server/services/qbo/api-base';

class TestQBOService extends withInvoiceSync(QBOServiceBase) {}

const TENANT = '00000000-0000-0000-0000-000000000001';
const INV_ID = 'inv-aaaaaaaa-0000-0000-0000-000000000001';
const QBO_ID = 'q1';

let db: BetterSQLite3Database<typeof schema>;
let qbo: TestQBOService;
let invoiceSvc: InvoiceService;

beforeEach(async () => {
    const fixture = createTestDb();
    db = fixture.db;
    await setupSchema(fixture.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

    qbo = new TestQBOService({} as D1Database, 'cid', 'csec', 'whsec', 'secret32chars_aaaaaaaaaaaaaaaa');
    invoiceSvc = new InvoiceService({} as D1Database);

    await db.insert(schema.tenants).values({
        id: TENANT, name: 'Acme', slug: 'acme', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await db.insert(schema.qboEntityMap).values({
        id: 'map-1', tenantId: TENANT, oiType: 'invoice', oiId: INV_ID,
        qboType: 'Invoice', qboId: QBO_ID, qboSyncToken: '1', syncedAt: new Date(),
    });
});

async function seedInvoice(amountCents: number) {
    await db.insert(schema.invoices).values({
        id: INV_ID, tenantId: TENANT, inspectionId: null, amountCents,
        lineItems: [{ description: 'Inspection', amountCents }],
        sentAt: new Date(), createdAt: new Date(), currency: 'USD',
    });
}

async function getInvoice() {
    const row = await db.select().from(schema.invoices).where(eq(schema.invoices.id, INV_ID)).get();
    if (!row) throw new Error('invoice not seeded');
    return row;
}

/** Remaining is DERIVED, never stored — the invoice total is the authority. */
async function remainingCents() {
    const inv = await getInvoice();
    return inv.amountCents - (inv.amountPaidCents ?? 0);
}

/**
 * The production wiring, verbatim: the QBO shape reaches
 * `applyInvoiceStatusFromQBO`, which converts dollars to cents once, and the
 * adapter hands the already-converted amount straight to the service.
 */
async function syncFromQbo(inv: Omit<InvoiceSummary, 'SyncToken'> & { SyncToken?: string }) {
    await qbo['applyInvoiceStatusFromQBO'](
        TENANT,
        { SyncToken: '1', ...inv },
        (invoiceId, tenantId) => invoiceSvc.markPaid(invoiceId, tenantId, 'qbo'),
        (invoiceId, amountPaidCents, tenantId) =>
            invoiceSvc.markPartial(invoiceId, tenantId, 'qbo', amountPaidCents),
    );
}

describe('QBO partial payment — capturing the amount', () => {
    it('records how much was paid when QBO reports a partial payment', async () => {
        // QBO speaks dollars: a $450 invoice with $200 still owed.
        await seedInvoice(45000);
        await syncFromQbo({ Id: QBO_ID, Balance: 200, TotalAmt: 450 });

        const inv = await getInvoice();
        expect(inv.amountPaidCents).toBe(25000);
        expect(inv.partialPaidAt).not.toBeNull();
    });

    it('derives remaining from OUR amount, not the QuickBooks total', async () => {
        // The invoice was edited in OI to $500 after QBO last saw $450. Remaining
        // must follow the authoritative record, which is ours.
        await seedInvoice(50000);
        await syncFromQbo({ Id: QBO_ID, Balance: 200, TotalAmt: 450 });

        expect(await remainingCents()).toBe(50000 - 25000);
    });

    it('rounds cents rather than truncating', async () => {
        // A $100 invoice with $18.15 still owed. Chosen because it DISCRIMINATES:
        // the naive float difference is 8184.999999999999, so truncating loses a
        // cent and reports $81.84 received against $81.85 actually paid. Most
        // dollar pairs divide evenly and would pass either way.
        await seedInvoice(10000);
        await syncFromQbo({ Id: QBO_ID, Balance: 18.15, TotalAmt: 100 });

        expect((await getInvoice()).amountPaidCents).toBe(8185);
        expect(await remainingCents()).toBe(1815);
    });

    it('hands the adapter cents already paid, not the dollar balance QBO sent', async () => {
        await seedInvoice(45000);
        const markPartial = vi.fn().mockResolvedValue(undefined);
        await qbo['applyInvoiceStatusFromQBO'](
            TENANT,
            { Id: QBO_ID, SyncToken: '1', Balance: 200, TotalAmt: 450 },
            vi.fn().mockResolvedValue(undefined),
            markPartial,
        );
        expect(markPartial).toHaveBeenCalledWith(INV_ID, 25000, TENANT);
    });

    it('reads the whole amount received once the invoice is paid in full', async () => {
        // The column now holds CUMULATIVE RECEIVED, summed from the payment
        // ledger. It used to be nulled here, back when a figure could only ever
        // describe a partial invoice; the ledger makes "paid, and here is how
        // much arrived" expressible, and remaining is derived against
        // amountCents, so a full figure states no outstanding balance.
        await seedInvoice(45000);
        await syncFromQbo({ Id: QBO_ID, Balance: 200, TotalAmt: 450 });
        await invoiceSvc.markPaid(INV_ID, TENANT, 'qbo');

        const inv = await getInvoice();
        expect(inv.partialPaidAt).toBeNull();
        expect(inv.amountPaidCents).toBe(45000);
        expect(await remainingCents()).toBe(0);
    });

    it('drops back to nothing received on a refund', async () => {
        // A refund is a ledger row reversing what arrived, not an erasure of the
        // fact that it did: 0 RECEIVED, which is a figure — not null, which is
        // "unknown".
        await seedInvoice(45000);
        await syncFromQbo({ Id: QBO_ID, Balance: 200, TotalAmt: 450 });
        await invoiceSvc.markRefunded(INV_ID, TENANT);

        const inv = await getInvoice();
        expect(inv.amountPaidCents).toBe(0);
        expect(inv.paidAt).toBeNull();
        expect(inv.partialPaidAt).toBeNull();
    });

    it('does not double-count a partial sync that repeats the same figure', async () => {
        // QBO reports a CUMULATIVE amount and the sync runs on every webhook and
        // every cron sweep. The first sweep lands because the ledger has nothing
        // to say yet; a replay of the same figure is agreement, and agreement
        // writes nothing.
        await seedInvoice(45000);
        await syncFromQbo({ Id: QBO_ID, Balance: 200, TotalAmt: 450 });
        await syncFromQbo({ Id: QBO_ID, Balance: 200, TotalAmt: 450 });

        expect((await getInvoice()).amountPaidCents).toBe(25000);
    });

    it('flags a figure that went DOWN instead of inventing a refund', async () => {
        // Once the ledger holds $250, QuickBooks reporting $100 is a
        // disagreement about money, not an instruction. Writing the $150 refund
        // that would reconcile them records a refund nobody issued — see
        // tests/unit/qbo/payment-discrepancy.spec.ts for the flag itself.
        await seedInvoice(45000);
        await syncFromQbo({ Id: QBO_ID, Balance: 200, TotalAmt: 450 });
        expect((await getInvoice()).amountPaidCents).toBe(25000);

        await syncFromQbo({ Id: QBO_ID, Balance: 350, TotalAmt: 450 });

        expect((await getInvoice()).amountPaidCents).toBe(25000);   // untouched
        const flags = await db.select().from(schema.qboSyncErrors)
            .where(eq(schema.qboSyncErrors.oiId, INV_ID)).all();
        expect(flags.map((f) => f.errorCode)).toEqual(['PAYMENT_DISCREPANCY']);
    });
});
