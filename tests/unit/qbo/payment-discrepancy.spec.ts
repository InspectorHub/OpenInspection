/**
 * When QuickBooks and our ledger disagree, say so — do not quietly make them
 * agree.
 *
 * Spec 2026-08-01 payment/deposit flow §6. The CDC sweep used to apply
 * QuickBooks' implied paid amount straight onto the invoice, which after the
 * payment ledger means APPENDING A ROW: an adjusting entry recording money
 * movement nobody performed, and one that is indistinguishable a month later
 * from money that really moved. Our ledger is authoritative for what we
 * collected; QuickBooks reports a balance and cannot reconstruct our rows.
 *
 * The line the sweep must not cross is drawn by whether the ledger has an
 * OPINION, not by whether its number happens to be zero — no rows means "we
 * have nothing to say about this invoice", which is exactly the pre-ledger
 * invoice QuickBooks legitimately still gets to inform.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('../../../server/lib/qbo-crypto', () => ({
    encryptToken: vi.fn(async (t: string) => `enc:${t}`),
    decryptToken: vi.fn(async (t: string) => t.replace('enc:', '')),
}));
vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { QBOServiceBase } from '../../../server/services/qbo/api-base';
import type { InvoiceSummary } from '../../../server/services/qbo/api-base';
import { withInvoiceSync } from '../../../server/services/qbo/invoice-sync';
import { withConnection } from '../../../server/services/qbo/connection';
import { InvoiceService } from '../../../server/services/invoice.service';
import { QBO_PAYMENT_DISCREPANCY } from '../../../server/lib/qbo-discrepancy';

/** Exposes the protected sweep step so the test drives the real decision. */
class TestQbo extends withInvoiceSync(withConnection(QBOServiceBase)) {
    apply(tenantId: string, inv: InvoiceSummary, markPaid: never, markPartial: never) {
        return this.applyInvoiceStatusFromQBO(tenantId, inv, markPaid, markPartial);
    }
}

const TENANT = '00000000-0000-0000-0000-000000000001';
const INSPECTION = 'insp-aaaaaaaa-0000-0000-0000-000000000001';
const INV_ID = 'inv-aaaaaaaa-0000-0000-0000-000000000001';
const QBO_ID = '147';
const TOTAL_CENTS = 45000;

const T1 = new Date('2026-03-01T10:00:00Z');
const T2 = new Date('2026-03-05T10:00:00Z');

/** QuickBooks says $450 total with $450 collected — TotalAmt/Balance in dollars. */
const QBO_SAYS_PAID_IN_FULL: InvoiceSummary = {
    Id: QBO_ID, SyncToken: '4', Balance: 0, TotalAmt: 450,
} as InvoiceSummary;
/** $360 collected of $450. */
const QBO_SAYS_360: InvoiceSummary = {
    Id: QBO_ID, SyncToken: '4', Balance: 90, TotalAmt: 450,
} as InvoiceSummary;

let db: BetterSQLite3Database<typeof schema>;
let qbo: TestQbo;
let invoiceSvc: InvoiceService;
let markPaid: ReturnType<typeof vi.fn>;
let markPartial: ReturnType<typeof vi.fn>;

beforeEach(async () => {
    const fixture = createTestDb();
    db = fixture.db;
    await setupSchema(fixture.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

    qbo = new TestQbo({} as D1Database, 'cid', 'csec', 'whsec', 'secret32chars_aaaaaaaaaaaaaaaa');
    invoiceSvc = new InvoiceService({} as D1Database);
    markPaid = vi.fn((id: string, tid: string) => invoiceSvc.markPaid(id, tid, 'qbo'));
    markPartial = vi.fn((id: string, cents: number, tid: string) => invoiceSvc.markPartial(id, tid, 'qbo', cents));

    await db.insert(schema.tenants).values({
        id: TENANT, slug: 'acme', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: T1,
    });
    await db.insert(schema.inspections).values({
        id: INSPECTION, tenantId: TENANT, propertyAddress: '1 Oak St', date: '2026-03-01', createdAt: T1,
    });
    await db.insert(schema.invoices).values({
        id: INV_ID, tenantId: TENANT, inspectionId: INSPECTION, amountCents: TOTAL_CENTS,
        lineItems: [{ description: 'Inspection', amountCents: TOTAL_CENTS }],
        sentAt: T1, createdAt: T1, currency: 'CAD',
    });
    await db.insert(schema.qboEntityMap).values({
        id: 'map-1', tenantId: TENANT, oiType: 'invoice', oiId: INV_ID,
        qboType: 'Invoice', qboId: QBO_ID, qboSyncToken: '1', syncedAt: T1,
    });
});

/**
 * A ledger holding $360 across two rows, inserted LATER money first so an
 * implementation that reads "the last row" cannot pass by accident.
 */
async function seedLedger360() {
    await db.insert(schema.orderPayments).values([
        {
            id: 'pay-balance-000-0000-0000-000000000002', tenantId: TENANT,
            inspectionId: INSPECTION, invoiceId: INV_ID, kind: 'balance',
            amountCents: 27000, method: 'card', occurredAt: T2, createdAt: T2,
        },
        {
            id: 'pay-deposit-000-0000-0000-000000000001', tenantId: TENANT,
            inspectionId: INSPECTION, invoiceId: INV_ID, kind: 'deposit',
            amountCents: 9000, method: 'cash', occurredAt: T1, createdAt: T1,
        },
    ]);
    await db.update(schema.invoices).set({ partialPaidAt: T2, amountPaidCents: 36000 })
        .where(eq(schema.invoices.id, INV_ID));
}

const ledgerRows = () => db.select().from(schema.orderPayments)
    .where(eq(schema.orderPayments.invoiceId, INV_ID)).all();

const openFlags = () => db.select().from(schema.qboSyncErrors)
    .where(and(eq(schema.qboSyncErrors.tenantId, TENANT), eq(schema.qboSyncErrors.resolved, false))).all();

describe('the CDC sweep records disagreement instead of adjusting', () => {
    it('flags both figures when QuickBooks reports more collected than the ledger holds', async () => {
        await seedLedger360();

        await qbo.apply(TENANT, QBO_SAYS_PAID_IN_FULL, markPaid as never, markPartial as never);

        const flags = await openFlags();
        expect(flags).toHaveLength(1);
        expect(flags[0].errorCode).toBe(QBO_PAYMENT_DISCREPANCY);
        expect(flags[0].oiId).toBe(INV_ID);
        // BOTH figures, because a human is the one who reconciles them.
        expect(JSON.parse(flags[0].errorMsg)).toEqual({ ledgerCents: 36000, qboCents: 45000 });
    });

    it('appends no adjusting row and leaves the cached figure alone', async () => {
        await seedLedger360();

        await qbo.apply(TENANT, QBO_SAYS_PAID_IN_FULL, markPaid as never, markPartial as never);

        // The row that would have appeared is the whole defect: $90 of receipt
        // that nobody collected, indistinguishable next month from real money.
        expect(await ledgerRows()).toHaveLength(2);
        const inv = await db.select().from(schema.invoices).where(eq(schema.invoices.id, INV_ID)).get();
        expect(inv?.amountPaidCents).toBe(36000);
        expect(inv?.paidAt).toBeNull();
        expect(markPaid).not.toHaveBeenCalled();
        expect(markPartial).not.toHaveBeenCalled();
    });

    it('resolves the flag once the two sides agree again', async () => {
        await seedLedger360();
        await qbo.apply(TENANT, QBO_SAYS_PAID_IN_FULL, markPaid as never, markPartial as never);
        expect(await openFlags()).toHaveLength(1);

        // Someone reconciled it in QuickBooks: 360 there, 360 here.
        await qbo.apply(TENANT, QBO_SAYS_360, markPaid as never, markPartial as never);

        expect(await openFlags()).toHaveLength(0);
        expect(await ledgerRows()).toHaveLength(2);
    });

    it('re-detecting the same disagreement refreshes it rather than stacking rows', async () => {
        await seedLedger360();
        await qbo.apply(TENANT, QBO_SAYS_PAID_IN_FULL, markPaid as never, markPartial as never);
        await qbo.apply(TENANT, QBO_SAYS_PAID_IN_FULL, markPaid as never, markPartial as never);

        const flags = await openFlags();
        expect(flags).toHaveLength(1);
        expect(flags[0].retries).toBe(1);
    });

    it('still applies QuickBooks when the ledger has NO opinion', async () => {
        // No rows at all: a pre-ledger invoice, or one an accountant settled in
        // QuickBooks. There is nothing to contradict, so this is the first
        // record rather than an adjustment — and flagging it instead would make
        // every legacy invoice a discrepancy nobody can act on.
        await qbo.apply(TENANT, QBO_SAYS_PAID_IN_FULL, markPaid as never, markPartial as never);

        expect(markPaid).toHaveBeenCalledWith(INV_ID, TENANT);
        expect(await openFlags()).toHaveLength(0);
        const inv = await db.select().from(schema.invoices).where(eq(schema.invoices.id, INV_ID)).get();
        expect(inv?.paidAt).not.toBeNull();
    });

    it('keeps a discrepancy and a failed push on one invoice apart', async () => {
        // They are two different things to look at. The open-row identity has to
        // include the code, or one silently overwrites the other.
        await seedLedger360();
        await db.insert(schema.qboSyncErrors).values({
            id: 'err-1', tenantId: TENANT, oiType: 'invoice', oiId: INV_ID,
            errorCode: 'SYNC_ERROR', errorMsg: 'QBO 503', retries: 0, resolved: false,
            createdAt: T1, updatedAt: T1,
        });

        await qbo.apply(TENANT, QBO_SAYS_PAID_IN_FULL, markPaid as never, markPartial as never);

        const codes = (await openFlags()).map((f) => f.errorCode).sort();
        expect(codes).toEqual([QBO_PAYMENT_DISCREPANCY, 'SYNC_ERROR']);
    });
});

describe('settings shows both figures and what is not synced at all', () => {
    beforeEach(async () => {
        await db.insert(schema.qboConnections).values({
            tenantId: TENANT, realmId: 'r1', companyName: 'Acme Books',
            accessToken: 'enc:a', refreshToken: 'enc:r',
            tokenExpiresAt: T2, refreshTokenExpiresAt: new Date('2027-01-01T00:00:00Z'),
            syncEnabled: true, defaultItemId: '1', createdAt: T1,
        });
    });

    it('reports each discrepancy with both figures and the invoice currency', async () => {
        await seedLedger360();
        await qbo.apply(TENANT, QBO_SAYS_PAID_IN_FULL, markPaid as never, markPartial as never);

        const status = await qbo.getConnectionStatus(TENANT);
        expect(status?.paymentDiscrepancies).toEqual([
            expect.objectContaining({ invoiceId: INV_ID, ledgerCents: 36000, qboCents: 45000, currency: 'CAD' }),
        ]);
        // A discrepancy is not a failed push; counting it as one buries it.
        expect(status?.openErrors).toBe(0);
    });

    it('discloses deposits held before any invoice, which never reach QuickBooks', async () => {
        // No invoice id: an unapplied deposit needs a liability account in the
        // tenant's chart of accounts, so it is deliberately never pushed. Saying
        // nothing here would read as "everything is synced".
        await db.insert(schema.orderPayments).values({
            id: 'pay-held-0000-0000-0000-000000000001', tenantId: TENANT,
            inspectionId: INSPECTION, invoiceId: null, kind: 'deposit',
            amountCents: 15000, method: 'card', occurredAt: T1, createdAt: T1,
        });

        const status = await qbo.getConnectionStatus(TENANT);
        expect(status?.heldDepositCount).toBe(1);
    });
});
