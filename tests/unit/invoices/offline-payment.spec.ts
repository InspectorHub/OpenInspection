/**
 * POST /api/invoices/{id}/payments — recording money that already moved.
 *
 * What these specs actually guard:
 *
 *  1. `occurred_at` is the INSPECTOR'S date, not `now()`. Tuesday's cash gets
 *     recorded on Thursday, and a test that passes when the field is ignored
 *     would be testing nothing — so the stored value is compared against
 *     Tuesday AND against the row's own `created_at`.
 *  2. The date is REQUIRED on the wire. A default is how the field becomes
 *     invisible, which is the same defect wearing a nicer face.
 *  3. Overpayment is refused, then allowed on an explicit confirm. A hard block
 *     is wrong (clients round up) and silent acceptance is wrong (it is usually
 *     a decimal-point typo).
 *  4. The capability gate is asserted at HTTP level against the REAL mounted
 *     route. A capability declared but never mounted is a defect this repo has
 *     already found once, and a unit call on the service could not see it.
 *  5. The ledger list is ordered by when money MOVED. The fixtures are seeded in
 *     a deliberately adverse order — the LATER movement recorded FIRST — so an
 *     implementation that orders by insertion cannot pass by accident.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { and, eq } from 'drizzle-orm';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { OpenAPIHono } from '@hono/zod-openapi';
import invoiceRoutes from '../../../server/api/invoices';
import { InvoiceService } from '../../../server/services/invoice.service';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';

const TENANT = '00000000-0000-0000-0000-000000000001';
const USER_ID = '00000000-0000-0000-0000-000000000300';
const INSP_ID = '550e8400-e29b-41d4-a716-446655440000';
const INV_ID = 'inv-aaaaaaaa-0000-0000-0000-000000000001';

/** Fixed instants, so "which date was stored" is assertable rather than luck. */
const TUESDAY = new Date('2026-03-03T09:00:00.000Z');
const WEDNESDAY = new Date('2026-03-04T09:00:00.000Z');
const THURSDAY = new Date('2026-03-05T09:00:00.000Z');

let db: BetterSQLite3Database<typeof schema>;
let markPaymentReceived: ReturnType<typeof vi.fn>;
let qboRecordPayment: ReturnType<typeof vi.fn>;

function buildApp(role = 'manager') {
    const app = new OpenAPIHono<HonoConfig>();
    markPaymentReceived = vi.fn().mockResolvedValue(undefined);
    qboRecordPayment = vi.fn().mockResolvedValue(undefined);
    app.use('*', async (c, next) => {
        c.set('userRole', role as never);
        c.set('tenantId', TENANT);
        c.set('user', { sub: USER_ID } as never);
        c.set('services', {
            invoice: new InvoiceService({} as D1Database),
            inspection: { markPaymentReceived } as never,
            qbo: { recordPayment: qboRecordPayment } as never,
        } as never);
        await next();
    });
    app.route('/api/invoices', invoiceRoutes);
    // Mirror the production onError AppError→status mapping (server/index.ts).
    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status as never);
        }
        throw err;
    });
    return app;
}

const ENV = { DB: {} } as never;
const CTX = { waitUntil: () => {}, passThroughOnException: () => {} } as never;

function postPayment(body: unknown, role = 'manager') {
    const req = new Request(`https://acme.example.com/api/invoices/${INV_ID}/payments`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    return buildApp(role).fetch(req, ENV, CTX);
}

function getPayments(role = 'manager') {
    const req = new Request(`https://acme.example.com/api/invoices/${INV_ID}/payments`, { method: 'GET' });
    return buildApp(role).fetch(req, ENV, CTX);
}

async function ledgerRows() {
    return db.select().from(schema.orderPayments)
        .where(and(eq(schema.orderPayments.tenantId, TENANT), eq(schema.orderPayments.invoiceId, INV_ID)))
        .all();
}

async function getInvoice() {
    const row = await db.select().from(schema.invoices).where(eq(schema.invoices.id, INV_ID)).get();
    if (!row) throw new Error('invoice not seeded');
    return row;
}

beforeEach(async () => {
    const fixture = createTestDb();
    db = fixture.db;
    await setupSchema(fixture.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

    await db.insert(schema.tenants).values({
        id: TENANT, name: 'Acme', slug: 'acme', status: 'active',
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

describe('POST /api/invoices/{id}/payments — recording', () => {
    it('appends a ledger row with the acting user as recorder', async () => {
        const res = await postPayment({
            amountCents: 20000, method: 'cash', occurredAt: TUESDAY.toISOString(), note: 'at the door',
        });
        expect(res.status).toBe(201);

        const rows = await ledgerRows();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            kind: 'balance', method: 'cash', amountCents: 20000,
            provider: null, providerRef: null, recordedBy: USER_ID, note: 'at the door',
        });
    });

    it('stores the date the money MOVED, not the time the row was written', async () => {
        // The whole reason this endpoint exists rather than another mark-paid:
        // Tuesday's cash gets recorded on Thursday. If the handler defaulted to
        // now(), occurredAt would equal createdAt and every reporting period
        // would be quietly wrong.
        const res = await postPayment({ amountCents: 20000, method: 'cash', occurredAt: TUESDAY.toISOString() });
        expect(res.status).toBe(201);

        const [row] = await ledgerRows();
        expect(row.occurredAt?.getTime()).toBe(TUESDAY.getTime());
        // And it is genuinely a DIFFERENT instant from the write — an assertion
        // that only Tuesday's value could satisfy.
        expect(row.occurredAt?.getTime()).not.toBe(row.createdAt?.getTime());
        expect(row.createdAt!.getTime()).toBeGreaterThan(row.occurredAt!.getTime());
    });

    it('requires the date — it is never defaulted away to now()', async () => {
        const res = await postPayment({ amountCents: 20000, method: 'cash' });
        expect(res.status).toBe(400);
        expect(await ledgerRows()).toHaveLength(0);
    });

    it('rejects a future occurred_at', async () => {
        const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
        const res = await postPayment({ amountCents: 100, method: 'cash', occurredAt: tomorrow.toISOString() });
        expect(res.status).toBe(400);
        expect(await ledgerRows()).toHaveLength(0);
    });

    it('refuses the card method on this endpoint', async () => {
        // Card payments come from the provider with a reference. Letting an
        // inspector hand-enter one creates a payment with no reconcilable
        // counterpart on the processor's side.
        const res = await postPayment({ amountCents: 100, method: 'card', occurredAt: TUESDAY.toISOString() });
        expect(res.status).toBe(400);
        expect(await ledgerRows()).toHaveLength(0);
    });

    it('rejects an amount that would overpay the invoice', async () => {
        const res = await postPayment({ amountCents: 99999, method: 'cash', occurredAt: TUESDAY.toISOString() });
        expect(res.status).toBe(422);
        const body = (await res.json()) as { error?: { message?: string } };
        expect(body.error?.message).toMatch(/exceeds/i);
        expect(await ledgerRows()).toHaveLength(0);
    });

    it('allows overpayment when explicitly confirmed', async () => {
        const res = await postPayment({
            amountCents: 99999, method: 'cash', occurredAt: TUESDAY.toISOString(), allowOverpayment: true,
        });
        expect(res.status).toBe(201);
        expect(await ledgerRows()).toHaveLength(1);
    });

    it('measures the overpayment against what is still outstanding, not the total', async () => {
        await postPayment({ amountCents: 20000, method: 'cash', occurredAt: TUESDAY.toISOString() });
        // 25000 remains; 30000 must now be refused even though it is under the
        // 45000 invoice total.
        const res = await postPayment({ amountCents: 30000, method: 'check', occurredAt: WEDNESDAY.toISOString() });
        expect(res.status).toBe(422);
        expect(await ledgerRows()).toHaveLength(1);
    });

    it('leaves a part-paid invoice partial, and closes the report gate only when settled', async () => {
        await postPayment({ amountCents: 20000, method: 'cash', occurredAt: TUESDAY.toISOString() });
        let inv = await getInvoice();
        expect(inv.amountPaidCents).toBe(20000);
        expect(inv.paidAt).toBeNull();
        expect(inv.partialPaidAt).not.toBeNull();
        expect(markPaymentReceived).not.toHaveBeenCalled();

        await postPayment({ amountCents: 25000, method: 'check', occurredAt: WEDNESDAY.toISOString() });
        inv = await getInvoice();
        expect(inv.amountPaidCents).toBe(45000);
        expect(inv.paidAt).not.toBeNull();
        expect(markPaymentReceived).toHaveBeenCalledWith(TENANT, INSP_ID);
    });

    it('404s for an invoice in another tenant', async () => {
        await db.insert(schema.tenants).values({
            id: 'tenant-two', name: 'Beta', slug: 'beta', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await db.update(schema.invoices).set({ tenantId: 'tenant-two' }).where(eq(schema.invoices.id, INV_ID));
        const res = await postPayment({ amountCents: 100, method: 'cash', occurredAt: TUESDAY.toISOString() });
        expect(res.status).toBe(404);
    });
});

describe('POST /api/invoices/{id}/payments — the capability gate', () => {
    it('403s an inspector without the financial capability', async () => {
        // Asserted over HTTP against the REAL mounted route: a route that
        // declares a capability but never mounts the guard still answers 200,
        // and only the status code can tell the two apart.
        const res = await postPayment(
            { amountCents: 100, method: 'cash', occurredAt: TUESDAY.toISOString() }, 'inspector',
        );
        expect(res.status).toBe(403);
        expect(await ledgerRows()).toHaveLength(0);
    });

    it('403s an agent on the ledger read', async () => {
        const res = await getPayments('agent');
        expect(res.status).toBe(403);
    });
});

describe('GET /api/invoices/{id}/payments', () => {
    it('returns the rows ordered by when the money moved, with the recorder named', async () => {
        // Adverse order: THURSDAY's cheque is recorded FIRST, so an
        // implementation ordering by insertion would put it at the top.
        await postPayment({ amountCents: 10000, method: 'check', occurredAt: THURSDAY.toISOString() });
        await postPayment({ amountCents: 20000, method: 'cash', occurredAt: TUESDAY.toISOString() });

        const res = await getPayments();
        expect(res.status).toBe(200);
        const body = (await res.json()) as { data: Array<Record<string, unknown>> };
        expect(body.data).toHaveLength(2);
        expect(body.data[0]).toMatchObject({ amountCents: 20000, method: 'cash', recordedByName: 'Dana Inspector' });
        expect(body.data[1]).toMatchObject({ amountCents: 10000, method: 'check' });
        expect(String(body.data[0].occurredAt)).toContain('2026-03-03');
    });

    it('never returns another tenant\'s rows', async () => {
        await postPayment({ amountCents: 20000, method: 'cash', occurredAt: TUESDAY.toISOString() });
        await db.update(schema.orderPayments).set({ tenantId: 'someone-else' })
            .where(eq(schema.orderPayments.invoiceId, INV_ID));

        const res = await getPayments();
        const body = (await res.json()) as { data: unknown[] };
        expect(body.data).toHaveLength(0);
    });
});
