/**
 * Refunds must reach QuickBooks.
 *
 * `createCreditMemo` was written, and no line ever called it — the same shape as
 * the two payment-push defects, one file over. Every refund a tenant granted
 * existed only in OI, so their books showed revenue that had been sent back.
 *
 * Wiring it is not one call, because there are THREE refund writers and they do
 * not all mean the same thing to a book of record:
 *
 *  - `refundPartial` — money off an invoice. This is the one that posts.
 *  - `refundHeldDeposit` — money off an ORDER with no invoice. QuickBooks was
 *    never told about that deposit (no invoice, so no QBO Invoice and no
 *    Payment), and crediting a customer for revenue QuickBooks never recorded
 *    would understate the tenant's income by the refund. It does NOT post.
 *  - `markRefunded` — has no production caller, so there is no seam to push
 *    from. It now returns its row so whoever gives it one can key correctly.
 *
 * Three things these specs are really guarding, all of them expensive:
 *
 *  1. The amount is DOLLARS on the wire and cents in the ledger. `Line[0].Amount`
 *     takes what it is handed, so a missing `/ 100` is a hundred times the
 *     refund on a customer's books.
 *  2. The memo is keyed and MAPPED on the refund ROW. `qbo_entity_map` is
 *     uniquely indexed on (tenant, oi_type, oi_id): under the invoice id it
 *     holds exactly one credit memo per invoice forever, and a second refund
 *     creates the memo in QuickBooks and then throws on the map insert.
 *  3. QuickBooks cannot fail the refund. The money moved in OI; an outage may
 *     lose the memo and never the refund.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import { QBOServiceBase } from '../../../server/services/qbo/api-base';
import { withInvoiceSync } from '../../../server/services/qbo/invoice-sync';
import { withCustomerSync } from '../../../server/services/qbo/customer-sync';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

import { OpenAPIHono } from '@hono/zod-openapi';
import cancellationRoutes from '../../../server/api/inspections/cancellation';
import { InvoiceService } from '../../../server/services/invoice.service';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';
import type { CancellationPolicy } from '../../../server/lib/billing/cancellation-policy';
import { recordPayment } from '../../../server/services/payment-ledger.service';
import { markRefunded } from '../../../server/services/invoice/refund';

const TENANT = '00000000-0000-0000-0000-000000000001';
const INSP = 'insp-aaaaaaaa-0000-0000-0000-000000000001';
const INV = 'inv-aaaaaaaa-0000-0000-0000-000000000001';
const CONTACT = 'contact-aaaa-0000-0000-000000000001';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

interface Call { method: string; path: string; body: unknown }

const requestIdOf = (path: string) =>
    new URLSearchParams(path.slice(path.indexOf('?') + 1)).get('requestid');

// --------------------------------------------------------------------------
// Part 1 — what goes on the wire.
//
// The db reads are one `select().from().where().get()` each (the connection and
// the tenant's timezone), so they are stubbed: this half is about the request we
// build, not the rows that feed it. Part 2 uses the real database.
// --------------------------------------------------------------------------

function stubDb(defaultTimezone?: string) {
    const chain = {
        select: () => chain,
        from: () => chain,
        where: () => chain,
        get: async () => ({ defaultItemId: 'ITEM-7', defaultTimezone }),
        insert: () => ({ values: () => ({ onConflictDoNothing: async () => undefined }) }),
    };
    return chain;
}

class ProbeQbo extends withInvoiceSync(withCustomerSync(QBOServiceBase)) {
    calls: Call[] = [];
    constructor(private readonly tenantTz?: string) {
        super({} as never, 'cid', 'secret', 'whsec', 'jwt');
    }
    public override getDrizzle() { return stubDb(this.tenantTz) as never; }
    public override async getQBOCustomerIdForInvoice(): Promise<string | null> { return 'QBO-CUST-9'; }
    public override async apiCall<T>(
        _tenantId: string, method: 'GET' | 'POST', path: string, body?: unknown,
    ): Promise<T> {
        this.calls.push({ method, path, body });
        return { CreditMemo: { Id: 'CM-1', SyncToken: '0' } } as T;
    }
}

/** Any fixed instant; the point is that it is not today. */
const MOVED = new Date('2026-09-08T00:00:00Z');
const ROW = 'row-11111111-2222-3333-4444-555555555555';

describe('createCreditMemo → QuickBooks', () => {
    it('posts the partial amount refunded, not the invoice total', async () => {
        // The cancellation ladder keeps a fee and returns the rest, so a partial
        // refund is the normal case. 22500 cents of a 45000 invoice is $225.
        const qbo = new ProbeQbo();
        await qbo.createCreditMemo(TENANT, INV, 225, ROW, MOVED);

        const body = qbo.calls[0].body as {
            Line: Array<{ Amount: number; SalesItemLineDetail: { UnitPrice: number; Qty: number; ItemRef: { value: string } } }>;
            CustomerRef: { value: string };
        };
        expect(qbo.calls).toHaveLength(1);
        expect(body.Line[0].Amount).toBe(225);
        expect(body.Line[0].SalesItemLineDetail).toMatchObject({ UnitPrice: 225, Qty: 1, ItemRef: { value: 'ITEM-7' } });
        expect(body.CustomerRef.value).toBe('QBO-CUST-9');
    });

    it('carries a requestid derived from the refund ROW, not the invoice', async () => {
        const qbo = new ProbeQbo();
        await qbo.createCreditMemo(TENANT, INV, 225, ROW, MOVED);

        expect(qbo.calls[0].path.startsWith('creditmemo')).toBe(true);
        expect(requestIdOf(qbo.calls[0].path)).toBe(`refund-${ROW}`);
        // Keyed on the invoice, two refunds are one fact to QuickBooks and the
        // second silently returns the first one's memo.
        expect(requestIdOf(qbo.calls[0].path)).not.toContain(INV);
    });

    it('sends the same key twice for the same row — QBO collapses the second', async () => {
        const qbo = new ProbeQbo();
        await qbo.createCreditMemo(TENANT, INV, 225, ROW, MOVED);
        await qbo.createCreditMemo(TENANT, INV, 225, ROW, MOVED);

        expect(qbo.calls).toHaveLength(2);                                       // both attempted
        expect(new Set(qbo.calls.map((c) => requestIdOf(c.path))).size).toBe(1);  // one key
    });

    it('books the memo on the date the money moved, not the push date', async () => {
        const qbo = new ProbeQbo();
        await qbo.createCreditMemo(TENANT, INV, 225, ROW, MOVED);
        expect((qbo.calls[0].body as { TxnDate: string }).TxnDate).toBe('2026-09-08');
    });

    it("derives the memo's calendar date in the tenant's timezone, not UTC", async () => {
        // 01:00 UTC on the 8th is still the evening of the 7th in Los Angeles.
        // At a month end that one day is the wrong accounting period.
        const qbo = new ProbeQbo('America/Los_Angeles');
        await qbo.createCreditMemo(TENANT, INV, 225, ROW, new Date('2026-09-08T01:00:00Z'));
        expect((qbo.calls[0].body as { TxnDate: string }).TxnDate).toBe('2026-09-07');
    });
});

// --------------------------------------------------------------------------
// Part 2 — the map row, against the real database and the real customer join.
// --------------------------------------------------------------------------

class DbQbo extends withInvoiceSync(withCustomerSync(QBOServiceBase)) {
    calls: Call[] = [];
    private n = 0;
    constructor(private readonly realDb: unknown) {
        super({} as never, 'cid', 'secret', 'whsec', 'jwt');
    }
    public override getDrizzle() { return this.realDb as never; }
    public override async apiCall<T>(
        _tenantId: string, method: 'GET' | 'POST', path: string, body?: unknown,
    ): Promise<T> {
        this.calls.push({ method, path, body });
        return { CreditMemo: { Id: `CM-${++this.n}`, SyncToken: '0' } } as T;
    }
}

describe('the credit memo is recorded against the refund row', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let qbo: DbQbo;

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        await setupSchema(fix.sqlite);
        qbo = new DbQbo(db);

        await db.insert(schema.tenants).values({
            id: TENANT, slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: MOVED,
        });
        await db.insert(schema.inspections).values({
            id: INSP, tenantId: TENANT, propertyAddress: '1 Oak St', date: '2026-09-08', createdAt: MOVED,
        } as never);
        await db.insert(schema.contacts).values({
            id: CONTACT, tenantId: TENANT, type: 'client', name: 'Pat Client', createdAt: MOVED,
        } as never);
        await db.insert(schema.qboConnections).values({
            tenantId: TENANT, realmId: 'r1', accessToken: 'a', refreshToken: 'r',
            tokenExpiresAt: MOVED, refreshTokenExpiresAt: MOVED,
            defaultItemId: 'ITEM-7', createdAt: MOVED,
        });
        await db.insert(schema.invoices).values({
            id: INV, tenantId: TENANT, inspectionId: INSP, contactId: CONTACT,
            amountCents: 45000, lineItems: [{ description: 'Inspection', amountCents: 45000 }],
            createdAt: MOVED, currency: 'USD',
        } as never);
        await db.insert(schema.qboEntityMap).values({
            id: 'map-contact', tenantId: TENANT, oiType: 'contact', oiId: CONTACT,
            qboType: 'Customer', qboId: 'QBO-CUST-9', qboSyncToken: '0', syncedAt: MOVED,
        });
    });

    const memoRows = () => db.select().from(schema.qboEntityMap)
        .where(and(eq(schema.qboEntityMap.tenantId, TENANT), eq(schema.qboEntityMap.oiType, 'refund'))).all();

    it('survives a SECOND refund on the same invoice', async () => {
        // The one the unique index on (tenant, oi_type, oi_id) makes impossible
        // under an invoice key: the second memo lands in QuickBooks and then the
        // map insert throws, so the tenant has a live credit nothing records.
        await qbo.createCreditMemo(TENANT, INV, 225, 'refund-row-A', MOVED);
        await qbo.createCreditMemo(TENANT, INV, 100, 'refund-row-B', MOVED);

        const rows = await memoRows();
        expect(rows.map((r) => r.oiId).sort()).toEqual(['refund-row-A', 'refund-row-B']);
        expect(rows.map((r) => r.qboId).sort()).toEqual(['CM-1', 'CM-2']);
        // No sync error was filed: both pushes really succeeded.
        expect(await db.select().from(schema.qboSyncErrors).all()).toHaveLength(0);
    });

    it('records no second map row, and no error, when one row is re-pushed', async () => {
        // requestid means QuickBooks answered the retry with the ORIGINAL memo.
        // Filing a failure here would put a false alarm in front of a tenant
        // whose books are correct.
        await qbo.createCreditMemo(TENANT, INV, 225, 'refund-row-A', MOVED);
        await qbo.createCreditMemo(TENANT, INV, 225, 'refund-row-A', MOVED);

        expect(await memoRows()).toHaveLength(1);
        expect(await db.select().from(schema.qboSyncErrors).all()).toHaveLength(0);
    });
});

// --------------------------------------------------------------------------
// Part 3 — the seam. The real cancel route, the real refund writers, the real
// database; `services.qbo` is the spy.
// --------------------------------------------------------------------------

/**
 * The route quotes against the real clock (`quoteCancellation`'s `now`
 * defaults), so the schedule is anchored to it rather than to a literal.
 */
const NOW = new Date();
const IN_12H = new Date(NOW.getTime() + 12 * 3_600_000);
const HOURS_AGO_24 = new Date(NOW.getTime() - 24 * 3_600_000);

/** 24h notice, 50% late fee — a late cancel keeps half and refunds half. */
const POLICY: CancellationPolicy = {
    noticeHours: 24,
    lateFee: { type: 'percent', percent: 50 },
    noShowFee: { type: 'percent', percent: 100 },
    remedy: 'refund',
};

describe('a cancellation refund reaches QuickBooks', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let createCreditMemo: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        await setupSchema(fix.sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
        createCreditMemo = vi.fn().mockResolvedValue(undefined);

        await db.insert(schema.tenants).values({
            id: TENANT, slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: NOW,
        });
        await db.insert(schema.tenantConfigs).values({
            tenantId: TENANT, updatedAt: NOW, cancellationPolicy: POLICY,
        } as never);
        await db.insert(schema.inspections).values({
            id: INSP, tenantId: TENANT, propertyAddress: '1 Oak St', date: '2026-08-07',
            status: 'confirmed', paymentStatus: 'paid', price: 45000, scheduledStartMs: IN_12H,
            agreementRequired: false, paymentRequired: true, createdAt: NOW,
        } as never);
    });

    /** An invoice with money received against it. */
    async function seedPaidInvoice(cents = 45000) {
        await db.insert(schema.contacts).values({
            id: CONTACT, tenantId: TENANT, type: 'client', name: 'Pat Client', createdAt: NOW,
        } as never);
        await db.insert(schema.invoices).values({
            id: INV, tenantId: TENANT, inspectionId: INSP, contactId: CONTACT,
            amountCents: 45000, lineItems: [{ description: 'Inspection', amountCents: 45000 }],
            createdAt: NOW, currency: 'USD',
        } as never);
        await recordPayment(db as AnyDb, TENANT, {
            invoiceId: INV, inspectionId: INSP, kind: 'balance',
            amountCents: cents, method: 'card', provider: 'stripe', providerRef: 'pi_1',
        });
    }

    /** Money against the ORDER, with no invoice raised — a booking deposit. */
    async function seedHeldDeposit(cents = 45000) {
        await recordPayment(db as AnyDb, TENANT, {
            invoiceId: null, inspectionId: INSP, kind: 'deposit',
            amountCents: cents, method: 'card', provider: 'stripe', providerRef: 'pi_2',
        });
    }

    function cancel(opts: {
        env?: Record<string, unknown>;
        reason?: string;
        acknowledgedFeeCents?: number;
    } = {}) {
        const settled: Promise<unknown>[] = [];
        const app = new OpenAPIHono<HonoConfig>();
        app.use('*', async (c, next) => {
            c.set('userRole', 'manager' as never);
            c.set('tenantId', TENANT);
            c.set('user', { sub: 'user-1' } as never);
            c.set('services', {
                invoice: new InvoiceService({} as D1Database),
                inspection: { cancelInspection: vi.fn().mockResolvedValue(undefined) },
                qbo: { createCreditMemo },
            } as never);
            await next();
        });
        app.route('/api/inspections', cancellationRoutes);
        app.onError((err, c) => {
            if (err instanceof AppError) {
                return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status as never);
            }
            throw err;
        });
        const req = new Request(`https://acme.example.com/api/inspections/${INSP}/cancel`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                reason: opts.reason ?? 'client_cancelled',
                acknowledgedFeeCents: opts.acknowledgedFeeCents ?? 22500,
            }),
        });
        const env = { DB: {}, JWT_SECRET: 'test-jwt-secret', QBO_CLIENT_ID: 'qbo-client', ...(opts.env ?? {}) };
        // Promise.resolve normalises `app.fetch`'s `Response | Promise<Response>`
        // return — the union has no `.then`.
        return Promise.resolve(app.fetch(req, env as never, {
            waitUntil: (p: Promise<unknown>) => { settled.push(p); }, passThroughOnException: () => {},
        } as never)).then(async (res) => { await Promise.allSettled(settled); return res; });
    }

    const refundRow = () => db.select().from(schema.orderPayments)
        .where(and(eq(schema.orderPayments.tenantId, TENANT), eq(schema.orderPayments.kind, 'refund'))).get();

    it('pushes a credit memo keyed on the refund row, in dollars', async () => {
        await seedPaidInvoice();

        const res = await cancel();
        expect(res.status).toBe(200);

        const row = await refundRow();
        expect(row?.amountCents).toBe(22500);
        // $225, the half returned — not $450, and not 22500.
        expect(createCreditMemo).toHaveBeenCalledWith(TENANT, INV, 225, row?.id, row?.occurredAt);
    });

    it('names the pushed row in the response, so the two cannot disagree', async () => {
        await seedPaidInvoice();
        const res = await cancel();
        const body = await res.json() as { data: { refundPaymentId: string } };
        const row = await refundRow();

        expect(body.data.refundPaymentId).toBe(row?.id);
        expect(createCreditMemo.mock.calls[0][3]).toBe(body.data.refundPaymentId);
    });

    it('pushes NOTHING for a held deposit, which QuickBooks was never told about', async () => {
        // No invoice was ever raised, so there is no QBO Invoice and no Payment.
        // A credit memo here credits the customer for revenue QuickBooks never
        // recorded and understates the tenant's income by the refund amount.
        await seedHeldDeposit();

        const res = await cancel();
        expect(res.status).toBe(200);

        // The refund itself absolutely happened — only the push is withheld.
        const row = await refundRow();
        expect(row?.amountCents).toBe(22500);
        expect(row?.invoiceId).toBeNull();
        expect(createCreditMemo).not.toHaveBeenCalled();
    });

    it('stands the refund up even when QuickBooks is down', async () => {
        // The money movement in OI is the source of truth. A QuickBooks outage
        // must not roll back or block a refund the tenant already granted.
        createCreditMemo.mockRejectedValue(new Error('QBO 503'));
        await seedPaidInvoice();

        const res = await cancel();

        expect(res.status).toBe(200);
        expect(createCreditMemo).toHaveBeenCalled();
        const row = await refundRow();
        expect(row?.amountCents).toBe(22500);
        // And the invoice's cached figure came down with it.
        const inv = await db.select().from(schema.invoices).where(eq(schema.invoices.id, INV)).get();
        expect(inv?.amountPaidCents).toBe(22500);
    });

    it('does not push when QuickBooks is not connected', async () => {
        await seedPaidInvoice();
        const res = await cancel({ env: { QBO_CLIENT_ID: undefined } });

        expect(res.status).toBe(200);
        expect(await refundRow()).toBeTruthy();
        expect(createCreditMemo).not.toHaveBeenCalled();
    });

    it('pushes nothing when the policy refunds nothing', async () => {
        // A no-show keeps 100%, so no money goes back and there is nothing to
        // credit. This is the non-discriminating control: it stays green under
        // the pre-fix code too, so a wholesale break in the push is
        // distinguishable from the bug being fixed.
        await seedPaidInvoice();
        await db.update(schema.inspections).set({ scheduledStartMs: HOURS_AGO_24 })
            .where(eq(schema.inspections.id, INSP));

        const res = await cancel({ reason: 'no_show', acknowledgedFeeCents: 45000 });
        expect(res.status).toBe(200);

        const body = await res.json() as { data: { refundPaymentId: string | null } };
        expect(body.data.refundPaymentId).toBeNull();
        expect(await refundRow()).toBeUndefined();
        expect(createCreditMemo).not.toHaveBeenCalled();
    });
});

// --------------------------------------------------------------------------
// Part 4 — markRefunded, the writer with no seam.
// --------------------------------------------------------------------------

describe('markRefunded can be keyed on later', () => {
    let db: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        await setupSchema(fix.sqlite);
        await db.insert(schema.tenants).values({
            id: TENANT, slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: NOW,
        });
        await db.insert(schema.inspections).values({
            id: INSP, tenantId: TENANT, propertyAddress: '1 Oak St', date: '2026-08-07', createdAt: NOW,
        } as never);
        await db.insert(schema.invoices).values({
            id: INV, tenantId: TENANT, inspectionId: INSP, amountCents: 45000,
            lineItems: [{ description: 'Inspection', amountCents: 45000 }], createdAt: NOW, currency: 'USD',
        } as never);
    });

    it('hands back the row it appended, so a future caller keys on the ROW', async () => {
        // It has no production caller and therefore no push. What it must not do
        // is return void: that is what forces the next person to key a credit
        // memo on the invoice id, which QuickBooks accepts and qbo_entity_map
        // then refuses to record.
        await recordPayment(db as AnyDb, TENANT, {
            invoiceId: INV, inspectionId: INSP, kind: 'balance',
            amountCents: 45000, method: 'card',
        });

        const appended = await markRefunded(db as AnyDb, INV, TENANT);

        const row = await db.select().from(schema.orderPayments)
            .where(and(eq(schema.orderPayments.invoiceId, INV), eq(schema.orderPayments.kind, 'refund'))).get();
        expect(appended?.id).toBe(row?.id);
        expect(appended?.amountCents).toBe(45000);
        expect(appended?.id).not.toBe(INV);
    });

    it('answers null when there was nothing to reverse', async () => {
        expect(await markRefunded(db as AnyDb, INV, TENANT)).toBeNull();
    });
});
