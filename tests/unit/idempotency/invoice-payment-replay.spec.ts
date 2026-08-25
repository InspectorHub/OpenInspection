/**
 * Tier 1: capturing money. Two endpoints record that a payment happened —
 * `/api/invoices/{id}/payments` (the append-only offline ledger) and
 * `/api/invoices/{id}/mark-paid` (settle in one shot) — and both fan out past
 * the invoice row: the report's payment gate is opened, and the movement is
 * pushed to QuickBooks.
 *
 * That fan-out is why the 201 is not the thing to assert on. The ledger is
 * append-only BY DESIGN — a correction is a new row, never an edit — so a
 * retried POST does not conflict with anything and does not look like an error
 * from any angle. It just books the same cash twice, and the operator finds out
 * at reconciliation.
 *
 * Both routes are tenant-authenticated, so `app.use('*', idempotencyGuard)`
 * already spans them; what is proven here is that the whole fan-out sits inside
 * that span, including the `executionCtx.waitUntil` push the handler schedules.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';

// InvoiceService resolves its own drizzle handle off the D1 binding.
vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import invoiceRoutes from '../../../server/api/invoices';
import { InvoiceService } from '../../../server/services/invoice.service';
import { idempotencyMiddleware } from '../../../server/lib/middleware/idempotency';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';
import { makeExecutionContext } from '../helpers/exec-ctx';

const TENANT = '00000000-0000-0000-0000-000000000001';
const USER_ID = '00000000-0000-0000-0000-000000000300';
const INSP_ID = '550e8400-e29b-41d4-a716-446655440000';
const INV_ID = 'inv-aaaaaaaa-0000-0000-0000-000000000001';
const TUESDAY = new Date('2026-03-03T09:00:00.000Z');

let db: BetterSQLite3Database<typeof schema>;
let markPaymentReceived: ReturnType<typeof vi.fn>;
let qboRecordPayment: ReturnType<typeof vi.fn>;

function buildApp() {
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('userRole', 'manager' as never);
        c.set('tenantId', TENANT);
        c.set('user', { sub: USER_ID } as never);
        c.set('services', {
            invoice: new InvoiceService({} as D1Database),
            inspection: { markPaymentReceived } as never,
            qbo: { recordPayment: qboRecordPayment } as never,
        } as never);
        await next();
    });
    app.use('*', idempotencyMiddleware({ getDb: () => db as never }));
    app.route('/api/invoices', invoiceRoutes);
    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status as never);
        }
        throw err;
    });
    return app;
}

// QBO connected, so the push is live and a duplicate is observable.
const ENV = { DB: {}, QBO_CLIENT_ID: 'qbo-test-client' } as never;
// `void p` did not even attach a catch, so a rejecting background promise was
// an unhandled rejection outright. The helper settles both at teardown.
const CTX = makeExecutionContext().ctx as never;

function post(path: string, body: unknown, key: string | null) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (key) headers['Idempotency-Key'] = key;
    return buildApp().fetch(
        new Request(`https://acme.example.com/api/invoices/${INV_ID}${path}`, {
            method: 'POST', headers, body: JSON.stringify(body),
        }),
        ENV, CTX,
    );
}

/**
 * A PARTIAL payment, deliberately. A retried payment that would settle the
 * invoice runs into the overpayment refusal first, so a spec written around a
 * full payment cannot see whether the guard did anything — the domain masks it.
 * A deposit retried against an unsettled balance is refused by nothing.
 */
const DEPOSIT = { amountCents: 20000, method: 'cash', occurredAt: TUESDAY.toISOString(), note: 'at the door' };
const FULL_PAYMENT = { ...DEPOSIT, amountCents: 45000 };

const recordPayment = (key: string | null, body: unknown = DEPOSIT) => post('/payments', body, key);
const markPaid = (key: string | null, method = 'check') => post('/mark-paid', { method }, key);

async function ledgerRows() {
    return db.select().from(schema.orderPayments)
        .where(and(eq(schema.orderPayments.tenantId, TENANT), eq(schema.orderPayments.invoiceId, INV_ID)))
        .all();
}

beforeEach(async () => {
    const fixture = createTestDb();
    db = fixture.db;
    await setupSchema(fixture.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    markPaymentReceived = vi.fn().mockResolvedValue(undefined);
    qboRecordPayment = vi.fn().mockResolvedValue(undefined);

    await db.insert(schema.tenants).values({
        id: TENANT, slug: 'acme', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await db.insert(schema.users).values({
        id: USER_ID, tenantId: TENANT, email: 'dana@acme.example.com',
        passwordHash: 'x', name: 'Dana Inspector', role: 'manager', createdAt: new Date(),
    });
    await db.insert(schema.inspections).values({
        id: INSP_ID, tenantId: TENANT, propertyAddress: '1 Oak St',
        date: '2026-03-01', createdAt: new Date(),
    });
    await db.insert(schema.invoices).values({
        id: INV_ID, tenantId: TENANT, inspectionId: INSP_ID, amountCents: 45000,
        lineItems: [{ description: 'Inspection', amountCents: 45000 }],
        sentAt: new Date(), createdAt: new Date(), currency: 'USD',
    });
});

describe("POST '/api/invoices/{id}/payments' — replay does not book the cash twice", () => {
    it('appends ONE ledger row when the same deposit is posted twice', async () => {
        const first = await recordPayment('pay-1');
        const second = await recordPayment('pay-1');

        expect(first.status).toBe(201);
        expect(second.status).toBe(201);
        // Append-only is the point: without containment the retry is a second
        // legitimate-looking $200 in the ledger, and nothing anywhere errors.
        const rows = await ledgerRows();
        expect(rows).toHaveLength(1);
        expect(rows.reduce((sum, r) => sum + r.amountCents, 0)).toBe(20000);
    });

    it('returns the SAME payment id on the replay, flagged as replayed', async () => {
        const a = await (await recordPayment('pay-1')).json() as { data: { id: string } };
        const replay = await recordPayment('pay-1');
        const b = await replay.json() as { data: { id: string } };

        expect(b.data.id).toBe(a.data.id);
        expect(replay.headers.get('Idempotency-Replayed')).toBe('true');
    });

    it('pushes the movement to QuickBooks once, not twice', async () => {
        await recordPayment('pay-1');
        await recordPayment('pay-1');
        expect(qboRecordPayment).toHaveBeenCalledTimes(1);
    });

    it('replays the original receipt when a SETTLING payment is retried', async () => {
        // The other half of the story. Where the retry would settle the invoice,
        // the overpayment refusal already stops the second row — so the guard is
        // not what saves the ledger here. What it changes is what the operator
        // is told: with it, the retry is the original 201 and the same payment
        // id; without it, someone who has banked one cheque is shown a balance
        // error and has to work out which of the two attempts counted. The
        // report payment gate is likewise opened once either way, which is why
        // there is no separate gate assertion on this route.
        const first = await recordPayment('pay-1', FULL_PAYMENT);
        const second = await recordPayment('pay-1', FULL_PAYMENT);

        expect(first.status).toBe(201);
        expect(second.status).toBe(201);
        expect(markPaymentReceived).toHaveBeenCalledTimes(1);
        expect(await ledgerRows()).toHaveLength(1);
    });

    it('records again under a fresh key — a genuine second payment still lands', async () => {
        await recordPayment('pay-1', DEPOSIT);
        await recordPayment('pay-2', { ...DEPOSIT, amountCents: 25000 });
        const rows = await ledgerRows();
        expect(rows).toHaveLength(2);
        expect(rows.reduce((sum, r) => sum + r.amountCents, 0)).toBe(45000);
    });

    it('refuses the key when the amount changed under it', async () => {
        await recordPayment('pay-1', DEPOSIT);
        const res = await recordPayment('pay-1', { ...DEPOSIT, amountCents: 25000 });

        expect(res.status).toBe(422);
        expect(await res.json()).toMatchObject({ error: { code: 'IDEMPOTENCY_KEY_REUSED' } });
        expect(await ledgerRows()).toHaveLength(1);
    });
});

describe("POST '/api/invoices/{id}/mark-paid' — replay does not re-settle", () => {
    it('opens the report payment gate once', async () => {
        // This is the guard's evidence on this route. The gate call is
        // UNCONDITIONAL on the handler's path — it does not consult whether a
        // ledger row was appended — so a replay that reached the handler fires
        // it a second time on an invoice that was already settled.
        const first = await markPaid('paid-1');
        const second = await markPaid('paid-1');

        expect(first.status).toBe(200);
        expect(second.status).toBe(200);
        expect(markPaymentReceived).toHaveBeenCalledTimes(1);
    });

    it('CHARACTERIZATION: markPaid is append-once on its own, guard or no guard', async () => {
        // Not evidence for the guard — stated so nobody later reads it as such.
        // markPaid returns the row it appended and nothing when the ledger
        // already covers the balance, and the QuickBooks push is conditional on
        // that return. Both therefore survive an unguarded replay; the payment
        // gate above does not, which is why the route still needed the guard.
        await markPaid('paid-1');
        await markPaid('paid-1');
        expect(await ledgerRows()).toHaveLength(1);
        expect(qboRecordPayment).toHaveBeenCalledTimes(1);
    });
});
