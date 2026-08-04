/**
 * The payment ledger — `order_payments` rows are the source of truth, and the
 * invoice's paid_at / partial_paid_at / amount_paid_cents are a cache exactly
 * one function writes.
 *
 * What these specs are actually guarding:
 *
 *  1. A REFUND can move an invoice back out of `paid`. That is the state the
 *     column model could not express at all — `markRefunded` had to null both
 *     timestamps and forget the money ever arrived — and it is why the ledger
 *     earns its keep.
 *  2. The derived state comes from a SUM over the rows, not from whichever row
 *     was written last. The fixtures below are seeded in a deliberately adverse
 *     order (later money inserted first, earlier money after) so an
 *     implementation that reads "the last row" cannot pass by accident.
 *  3. A redelivered webhook appends nothing. The unique index guards it in the
 *     database; the service must not double-count on the way there.
 *  4. Two identical offline payments are two payments. SQLite treats NULLs as
 *     distinct in a unique index, so the same index that dedupes Stripe must
 *     not block a customer handing over $1 twice.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { and, eq } from 'drizzle-orm';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { recordPayment, recomputeInvoicePaymentState } from '../../../server/services/payment-ledger.service';

const TENANT = '00000000-0000-0000-0000-000000000001';
const INSPECTION = 'insp-aaaaaaaa-0000-0000-0000-000000000001';
const INV_ID = 'inv-aaaaaaaa-0000-0000-0000-000000000001';
const STANDALONE_INV = 'inv-aaaaaaaa-0000-0000-0000-000000000002';

/** Fixed instants so "which timestamp won" is assertable, not wall-clock luck. */
const T1 = new Date('2026-03-01T10:00:00Z');
const T2 = new Date('2026-03-05T10:00:00Z');
const T3 = new Date('2026-03-09T10:00:00Z');

let db: BetterSQLite3Database<typeof schema>;

beforeEach(async () => {
    const fixture = createTestDb();
    db = fixture.db;
    await setupSchema(fixture.sqlite);

    await db.insert(schema.tenants).values({
        id: TENANT, name: 'Acme', slug: 'acme', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await db.insert(schema.inspections).values({
        id: INSPECTION, tenantId: TENANT, propertyAddress: '1 Oak St',
        date: '2026-03-01', createdAt: T1,
    });
    await db.insert(schema.invoices).values([
        {
            id: INV_ID, tenantId: TENANT, inspectionId: INSPECTION, amountCents: 45000,
            lineItems: [{ description: 'Inspection', amountCents: 45000 }],
            sentAt: T1, createdAt: T1, currency: 'USD',
        },
        {
            // No inspection: the New Invoice form submits null on a blank field,
            // and a payment against one of these must still be recordable.
            id: STANDALONE_INV, tenantId: TENANT, inspectionId: null, amountCents: 20000,
            lineItems: [{ description: 'Consultation', amountCents: 20000 }],
            sentAt: T1, createdAt: T1, currency: 'USD',
        },
    ]);
});

async function getInvoice(id = INV_ID) {
    const row = await db.select().from(schema.invoices).where(eq(schema.invoices.id, id)).get();
    if (!row) throw new Error('invoice not seeded');
    return row;
}

async function ledgerRows(invoiceId = INV_ID) {
    return db.select().from(schema.orderPayments)
        .where(and(eq(schema.orderPayments.tenantId, TENANT), eq(schema.orderPayments.invoiceId, invoiceId)))
        .all();
}

async function countLedgerRows(invoiceId = INV_ID) {
    return (await ledgerRows(invoiceId)).length;
}

describe('payment ledger — recording', () => {
    it('stamps the row with the order the invoice belongs to', async () => {
        await recordPayment(db, TENANT, { invoiceId: INV_ID, kind: 'balance', amountCents: 45000, method: 'card', occurredAt: T1 });
        const [row] = await ledgerRows();
        expect(row.inspectionId).toBe(INSPECTION);
        expect(row.amountCents).toBe(45000);   // always positive; direction is in `kind`
        expect(row.kind).toBe('balance');
    });

    it('records a payment against a standalone invoice that has no order', async () => {
        await recordPayment(db, TENANT, { invoiceId: STANDALONE_INV, kind: 'balance', amountCents: 20000, method: 'check', occurredAt: T1 });
        const [row] = await ledgerRows(STANDALONE_INV);
        expect(row.inspectionId).toBeNull();
        expect((await getInvoice(STANDALONE_INV)).paidAt).not.toBeNull();
    });

    it('refuses a row that points at neither an order nor an invoice', async () => {
        await expect(recordPayment(db, TENANT, { kind: 'deposit', amountCents: 100, method: 'cash' }))
            .rejects.toThrow();
        expect(await countLedgerRows()).toBe(0);
    });

    it('refuses a negative or zero amount — direction belongs in `kind`', async () => {
        await expect(recordPayment(db, TENANT, { invoiceId: INV_ID, kind: 'refund', amountCents: -100, method: 'card' }))
            .rejects.toThrow();
        await expect(recordPayment(db, TENANT, { invoiceId: INV_ID, kind: 'balance', amountCents: 0, method: 'card' }))
            .rejects.toThrow();
        expect(await countLedgerRows()).toBe(0);
    });
});

describe('payment ledger — the derived invoice state', () => {
    it('derives paid-in-full from the ledger', async () => {
        await recordPayment(db, TENANT, { invoiceId: INV_ID, kind: 'balance', amountCents: 45000, method: 'card', occurredAt: T1 });

        const inv = await getInvoice();
        expect(inv.paidAt).not.toBeNull();
        expect(inv.partialPaidAt).toBeNull();
        expect(inv.amountPaidCents).toBe(45000);   // cumulative RECEIVED, not a remainder
    });

    it('derives partial from two rows that do not yet total the invoice', async () => {
        // Adverse order: the LATER payment is appended FIRST, so a "read the last
        // row" implementation would report 10000 and stamp the wrong instant.
        await recordPayment(db, TENANT, { invoiceId: INV_ID, kind: 'balance', amountCents: 15000, method: 'card', occurredAt: T3 });
        await recordPayment(db, TENANT, { invoiceId: INV_ID, kind: 'deposit', amountCents: 10000, method: 'cash', occurredAt: T1 });

        const inv = await getInvoice();
        expect(inv.amountPaidCents).toBe(25000);
        expect(inv.paidAt).toBeNull();
        expect(inv.partialPaidAt?.getTime()).toBe(T3.getTime());
    });

    it('subtracts refunds and can move an invoice back out of paid', async () => {
        await recordPayment(db, TENANT, { invoiceId: INV_ID, kind: 'balance', amountCents: 45000, method: 'card', occurredAt: T1 });
        expect((await getInvoice()).paidAt).not.toBeNull();

        await recordPayment(db, TENANT, { invoiceId: INV_ID, kind: 'refund', amountCents: 20000, method: 'card', occurredAt: T2 });

        const inv = await getInvoice();
        expect(inv.amountPaidCents).toBe(25000);
        expect(inv.paidAt).toBeNull();             // no longer paid in full
        expect(inv.partialPaidAt).not.toBeNull();
    });

    it('lands on nothing received when the whole payment is refunded', async () => {
        await recordPayment(db, TENANT, { invoiceId: INV_ID, kind: 'balance', amountCents: 45000, method: 'card', occurredAt: T1 });
        await recordPayment(db, TENANT, { invoiceId: INV_ID, kind: 'refund', amountCents: 45000, method: 'card', occurredAt: T2 });

        const inv = await getInvoice();
        expect(inv.amountPaidCents).toBe(0);       // 0 received is a FACT; null would mean "unknown"
        expect(inv.paidAt).toBeNull();
        expect(inv.partialPaidAt).toBeNull();
    });

    it('counts an adjustment towards the total like any other receipt', async () => {
        await recordPayment(db, TENANT, { invoiceId: INV_ID, kind: 'deposit', amountCents: 40000, method: 'cash', occurredAt: T1 });
        await recordPayment(db, TENANT, { invoiceId: INV_ID, kind: 'adjustment', amountCents: 5000, method: 'other', occurredAt: T2 });

        expect((await getInvoice()).paidAt).not.toBeNull();
    });

    it('leaves a legacy invoice alone when it has no ledger rows at all', async () => {
        // Recompute is not a bulldozer: an invoice marked paid before the ledger
        // existed has no rows, and zeroing it would erase a real payment.
        await db.update(schema.invoices).set({ paidAt: T1, paymentMethod: 'check' })
            .where(eq(schema.invoices.id, INV_ID));

        await recomputeInvoicePaymentState(db, TENANT, INV_ID);

        const inv = await getInvoice();
        expect(inv.paidAt?.getTime()).toBe(T1.getTime());
        expect(inv.amountPaidCents).toBeNull();
    });

    it('never reaches across tenants', async () => {
        await recordPayment(db, TENANT, { invoiceId: INV_ID, kind: 'balance', amountCents: 45000, method: 'card', occurredAt: T1 });
        await recomputeInvoicePaymentState(db, 'some-other-tenant', INV_ID);

        expect((await getInvoice()).amountPaidCents).toBe(45000);   // untouched
    });
});

describe('payment ledger — one writer', () => {
    it('is the only thing in server/ that writes the derived payment columns', () => {
        // The regression this whole task exists to avoid. A second writer fails
        // no behavioural test — it just makes the cache disagree with the money
        // weeks later, which is the expensive kind of wrong.
        //
        // Scoped to `.set({...})`, i.e. UPDATEs of an existing invoice. Creating
        // a row with `paidAt: null` in its `.values()` is not a cache write, and
        // neither is a SELECT projection or a Zod field of the same name — which
        // is why a bare identifier grep would be all noise.
        const serverDir = path.resolve(__dirname, '../../../server');
        const allowed = ['services/payment-ledger.service.ts'];
        const offenders: string[] = [];

        const walk = (dir: string) => {
            for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, e.name);
                if (e.isDirectory()) { walk(full); continue; }
                if (!e.name.endsWith('.ts')) continue;
                const rel = path.relative(serverDir, full).split(path.sep).join('/');
                if (allowed.includes(rel)) continue;
                const src = fs.readFileSync(full, 'utf8');
                for (const block of src.match(/\.set\(\{[\s\S]*?\}\)/g) ?? []) {
                    if (/\b(paidAt|partialPaidAt|amountPaidCents)\s*:/.test(block)) offenders.push(rel);
                }
            }
        };
        walk(serverDir);

        expect([...new Set(offenders)]).toEqual([]);
    });
});

describe('payment ledger — idempotency', () => {
    it('is idempotent on a redelivered provider ref', async () => {
        const entry = {
            invoiceId: INV_ID, kind: 'balance' as const, amountCents: 45000, method: 'card' as const,
            provider: 'stripe' as const, providerRef: 'pi_123', occurredAt: T1,
        };
        const first = await recordPayment(db, TENANT, entry);
        const second = await recordPayment(db, TENANT, entry);   // webhook redelivery

        expect(first).toBe(true);
        expect(second).toBe(false);
        expect(await countLedgerRows()).toBe(1);
        expect((await getInvoice()).amountPaidCents).toBe(45000);
    });

    it('never lets two offline rows collide', async () => {
        // provider/providerRef are NULL for both; SQLite's NULL-distinct semantics
        // must NOT be relied on to dedupe these, and must not block them either.
        await recordPayment(db, TENANT, { invoiceId: INV_ID, kind: 'deposit', amountCents: 100, method: 'cash', occurredAt: T1 });
        await recordPayment(db, TENANT, { invoiceId: INV_ID, kind: 'deposit', amountCents: 100, method: 'cash', occurredAt: T1 });

        expect(await countLedgerRows()).toBe(2);
        expect((await getInvoice()).amountPaidCents).toBe(200);
    });

    it('lets the same provider ref exist once per tenant', async () => {
        await db.insert(schema.tenants).values({
            id: 'tenant-two', name: 'Beta', slug: 'beta', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await db.insert(schema.invoices).values({
            id: 'inv-other', tenantId: 'tenant-two', inspectionId: null, amountCents: 100,
            lineItems: [], sentAt: T1, createdAt: T1, currency: 'USD',
        });

        await recordPayment(db, TENANT, { invoiceId: INV_ID, kind: 'balance', amountCents: 100, method: 'card', provider: 'stripe', providerRef: 'pi_shared', occurredAt: T1 });
        const other = await recordPayment(db, 'tenant-two', { invoiceId: 'inv-other', kind: 'balance', amountCents: 100, method: 'card', provider: 'stripe', providerRef: 'pi_shared', occurredAt: T1 });

        expect(other).toBe(true);
    });
});
