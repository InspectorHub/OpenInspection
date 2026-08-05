/**
 * What goes to QuickBooks is the payment, not the invoice.
 *
 * Both push sites used to send `invoice.amountCents` — the TOTAL — keyed by the
 * invoice id. That is correct only while payment is all-or-nothing. With a
 * ledger it is wrong twice over on a $450 inspection with a $90 deposit:
 *
 *  - the amount is $450 when $360 arrived, and the deposit push already there
 *    makes $540 of recorded revenue out of $450 of money;
 *  - the key is the invoice, so the deposit and the balance are the same "fact"
 *    to QuickBooks, and the second one silently returns the first one's
 *    response instead of booking anything.
 *
 * The fix is that both sites push the row `markPaid` RETURNED: its amount is
 * what moved on this occasion, and its id names the fact. Which also means an
 * append that did not happen — a redelivery, an already-paid invoice, rows the
 * backfill wrote straight to D1 — pushes nothing at all, rather than pushing
 * again and trusting QBO's requestid to absorb it.
 *
 * These specs drive the REAL mounted routes against in-memory SQLite with a
 * real InvoiceService, so the amount and the key are the ones production
 * computes. `services.qbo` is the spy — the lowest-level seam that still fails
 * when the wrong number goes on the wire.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

const verifyWebhook = vi.fn();
vi.mock('../../../server/services/stripe.service', () => ({
    StripeService: class { constructor(_k: string) { void _k; } verifyWebhook = verifyWebhook; },
}));

import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { OpenAPIHono } from '@hono/zod-openapi';
import { Hono } from 'hono';
import invoiceRoutes from '../../../server/api/invoices';
import stripeWebhookApi from '../../../server/api/stripe-webhook';
import { InvoiceService } from '../../../server/services/invoice.service';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';

const TENANT = '00000000-0000-0000-0000-000000000001';
const INSPECTION = 'insp-aaaaaaaa-0000-0000-0000-000000000001';
const INV_ID = 'inv-aaaaaaaa-0000-0000-0000-000000000001';
const TOTAL_CENTS = 45000;
const DEPOSIT_CENTS = 9000;

/** Fixed instants so nothing here depends on wall-clock ordering. */
const T1 = new Date('2026-03-01T10:00:00Z');
const T2 = new Date('2026-03-05T10:00:00Z');

let db: BetterSQLite3Database<typeof schema>;
let recordPaymentSpy: ReturnType<typeof vi.fn>;

/** `[amountInDollars, requestKey]` for every payment push that was attempted. */
const pushes = (): Array<[number, string]> =>
    recordPaymentSpy.mock.calls.map((c) => [c[2] as number, c[3] as string]);

beforeEach(async () => {
    const fixture = createTestDb();
    db = fixture.db;
    await setupSchema(fixture.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    recordPaymentSpy = vi.fn().mockResolvedValue(undefined);
    verifyWebhook.mockReset();

    await db.insert(schema.tenants).values({
        id: TENANT, name: 'Acme', slug: 'acme', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: T1,
    });
    await db.insert(schema.inspections).values({
        id: INSPECTION, tenantId: TENANT, propertyAddress: '1 Oak St',
        date: '2026-03-01', createdAt: T1,
    });
    await db.insert(schema.invoices).values({
        id: INV_ID, tenantId: TENANT, inspectionId: INSPECTION, amountCents: TOTAL_CENTS,
        lineItems: [{ description: 'Inspection', amountCents: TOTAL_CENTS }],
        sentAt: T1, createdAt: T1, currency: 'USD',
    });
});

/** A deposit already collected — the state that makes the total the wrong number. */
async function seedDeposit() {
    await db.insert(schema.orderPayments).values({
        id: 'pay-deposit-0000-0000-0000-000000000001',
        tenantId: TENANT, inspectionId: INSPECTION, invoiceId: INV_ID,
        kind: 'deposit', amountCents: DEPOSIT_CENTS, method: 'cash',
        occurredAt: T1, createdAt: T1,
    });
    await db.update(schema.invoices).set({ partialPaidAt: T1, amountPaidCents: DEPOSIT_CENTS })
        .where(eq(schema.invoices.id, INV_ID));
}

/** The ledger row the invoice acquired during this test, whatever its id is. */
async function appendedBalanceRow() {
    const rows = await db.select().from(schema.orderPayments)
        .where(and(eq(schema.orderPayments.invoiceId, INV_ID), eq(schema.orderPayments.kind, 'balance')))
        .all();
    return rows[0] ?? null;
}

// --- the manual "mark as paid" route --------------------------------------

const ENV = { DB: {}, QBO_CLIENT_ID: 'qbo-client', JWT_SECRET: 'test-jwt-secret' } as never;

function markPaid(method = 'check') {
    const settled: Promise<unknown>[] = [];
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('userRole', 'manager' as never);
        c.set('tenantId', TENANT);
        c.set('services', {
            invoice: new InvoiceService({} as D1Database),
            inspection: { markPaymentReceived: vi.fn().mockResolvedValue(undefined) },
            qbo: { recordPayment: recordPaymentSpy },
        } as never);
        await next();
    });
    app.route('/api/invoices', invoiceRoutes);
    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status as never);
        }
        throw err;
    });
    const req = new Request(`https://acme.example.com/api/invoices/${INV_ID}/mark-paid`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method }),
    });
    return app.fetch(req, ENV, {
        waitUntil: (p: Promise<unknown>) => { settled.push(p); }, passThroughOnException: () => {},
    } as never).then(async (res) => { await Promise.allSettled(settled); return res; });
}

describe('mark-paid → QuickBooks', () => {
    it('pushes the remainder collected, not the invoice total', async () => {
        await seedDeposit();

        const res = await markPaid();
        expect(res.status).toBe(200);

        // $360 — the balance. NOT $450, which is what the invoice says it costs.
        expect(pushes()).toEqual([[360, expect.stringMatching(/^pay-/) as unknown as string]]);
    });

    it('keys the push on the ledger row, so a deposit and a balance are two facts', async () => {
        await seedDeposit();
        await markPaid();

        const row = await appendedBalanceRow();
        expect(row).not.toBeNull();
        expect(pushes()[0][1]).toBe(`pay-${row?.id}`);
        // The invoice id is what it used to be keyed on, and keying two payments
        // on it makes QBO return the deposit's response for the balance.
        expect(pushes()[0][1]).not.toBe(`pay-${INV_ID}`);
    });

    it('pushes the whole total when that really is what was collected', async () => {
        await markPaid();
        expect(pushes().map(([amount]) => amount)).toEqual([450]);
    });

    it('pushes nothing for an invoice already paid before the ledger existed', async () => {
        // The backfill writes rows straight to D1 for invoices QuickBooks was
        // already told about by the original manual flow. Nothing appends here,
        // so nothing can push — re-pushing would double their recorded revenue.
        await db.insert(schema.orderPayments).values({
            id: 'pay-backfill-000-0000-0000-000000000001',
            tenantId: TENANT, inspectionId: INSPECTION, invoiceId: INV_ID,
            kind: 'balance', amountCents: TOTAL_CENTS, method: 'offline',
            note: 'backfilled from invoice record', occurredAt: T1, createdAt: T2,
        });
        await db.update(schema.invoices).set({ paidAt: T1, amountPaidCents: TOTAL_CENTS })
            .where(eq(schema.invoices.id, INV_ID));

        const res = await markPaid();
        expect(res.status).toBe(200);
        expect(pushes()).toEqual([]);
    });
});

// --- the Stripe webhook ---------------------------------------------------

const SIG = { 'stripe-signature': 't=1,v1=x' };
const SETTLED = {
    type: 'payment_intent.succeeded',
    data: { object: { metadata: { invoiceId: INV_ID, tenantId: TENANT, inspectionId: INSPECTION } } },
};

function deliverWebhook() {
    verifyWebhook.mockResolvedValue(SETTLED);
    const settled: Promise<unknown>[] = [];
    const kv = { get: vi.fn().mockResolvedValue(null), put: vi.fn() };
    const app = new Hono();
    app.use('*', async (c, next) => {
        c.set('tenantId' as never, TENANT as never);
        (c as { env: Record<string, unknown> }).env = {
            TENANT_CACHE: kv, STRIPE_SECRET_KEY: 'sk_test_1',
            STRIPE_WEBHOOK_SECRET: 'whsec_1', QBO_CLIENT_ID: 'qbo-client',
        };
        c.set('services' as never, {
            invoice: new InvoiceService({} as D1Database),
            inspection: { markPaymentReceived: vi.fn().mockResolvedValue(undefined) },
            qbo: { recordPayment: recordPaymentSpy },
        } as never);
        Object.defineProperty(c, 'executionCtx', {
            value: { waitUntil: (p: Promise<unknown>) => { settled.push(p); } }, configurable: true,
        });
        await next();
    });
    app.route('/', stripeWebhookApi);
    return app.request('/', { method: 'POST', headers: SIG, body: '{}' })
        .then(async (res) => { await Promise.allSettled(settled); return res; });
}

describe('a settled card payment → QuickBooks', () => {
    it('pushes what the card actually settled, not the invoice total', async () => {
        await seedDeposit();

        const res = await deliverWebhook();
        expect(res.status).toBe(200);

        const row = await appendedBalanceRow();
        expect(pushes()).toEqual([[360, `pay-${row?.id}`]]);
    });

    it('pushes nothing on redelivery, rather than pushing again under one key', async () => {
        await seedDeposit();
        await deliverWebhook();
        await deliverWebhook();     // Stripe redelivers; the invoice is paid already.

        expect(pushes()).toHaveLength(1);
    });
});
