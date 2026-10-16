/**
 * Cancelling and the `inspectionFees` capability.
 *
 * A cancellation prices itself (a fee, a refund) and moves money on the ledger.
 * Without `inspectionFees` a caller may still cancel an inspection that has no money
 * attached, but must never be shown, or be the one to commit, a charge or a
 * refund. When money is involved the refusal body carries no amount either.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { InspectionService } from '../../../server/services/inspection.service';
import { recordPayment } from '../../../server/services/payment-ledger.service';
import { ScopedDB } from '../../../server/lib/db/scoped';
import { AppError } from '../../../server/lib/errors';
import type { CancellationPolicy } from '../../../server/lib/billing/cancellation-policy';
import type { HonoConfig } from '../../../server/types/hono';
import type { UserRole } from '../../../server/types/auth';
import { createTestDb, setupSchema } from '../db';
import { makeExecutionContext } from '../helpers/exec-ctx';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
// eslint-disable-next-line import/order
import cancellationRoutes from '../../../server/api/inspections/cancellation';

const T = '00000000-0000-0000-0000-000000000001';
const ENV = { DB: {} } as HonoConfig['Bindings'];
const EXEC = makeExecutionContext().ctx;
const MONEY_KEY = /"(price|[A-Za-z]*Cents)"\s*:/;
const NO_FEES = { inspectionFees: false };
const POLICY: CancellationPolicy = {
    noticeHours: 24,
    lateFee: { type: 'percent', percent: 50 },
    noShowFee: { type: 'percent', percent: 100 },
    remedy: 'refund',
};
let db: BetterSQLite3Database<typeof schema>;

function buildApp(role: UserRole, overrides: Record<string, boolean> | null = null) {
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    const app = new OpenAPIHono<HonoConfig>();
    app.onError((err, c) => (err instanceof AppError
        ? c.json({ success: false, error: { code: err.code, message: err.message, details: err.details } }, err.status)
        : c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500)));
    const sdb = new ScopedDB(db as never, T);
    app.use('*', async (c, next) => {
        c.set('tenantId', T);
        c.set('userRole', role);
        c.set('user', { sub: 'actor', role, tenantId: T });
        c.set('sdb', { getById: async () => ({ permissionOverrides: overrides }) } as unknown as HonoConfig['Variables']['sdb']);
        c.set('services', {
            inspection: new InspectionService({} as D1Database, undefined, sdb),
        } as unknown as HonoConfig['Variables']['services']);
        await next();
    });
    app.route('/api/inspections', cancellationRoutes);
    return app;
}

const quote = (app: OpenAPIHono<HonoConfig>, id: string) =>
    app.request(`/api/inspections/${id}/cancellation-quote?reason=client_cancelled`, {}, ENV, EXEC);
const cancel = (app: OpenAPIHono<HonoConfig>, id: string, extra: Record<string, unknown> = {}) =>
    app.request(`/api/inspections/${id}/cancel`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'client_cancelled', ...extra }),
    }, ENV, EXEC);

const statusOf = async (id: string) =>
    (await db.select({ s: schema.inspections.status }).from(schema.inspections).where(eq(schema.inspections.id, id)).get())!.s;

beforeEach(async () => {
    const fix = createTestDb();
    db = fix.db;
    await setupSchema(fix.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    const now = new Date();
    await db.insert(schema.tenants).values({
        id: T, slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: now,
    });
    await db.insert(schema.tenantConfigs).values({ tenantId: T, updatedAt: now, cancellationPolicy: POLICY } as never);
    const soon = new Date(Date.now() + 12 * 3_600_000);
    // i-free: nothing owed, nothing collected. i-paid: fully paid by card.
    await db.insert(schema.inspections).values([
        { id: 'i-free', tenantId: T, propertyAddress: '1 St', date: '2099-08-07', status: 'confirmed',
          paymentStatus: 'unpaid', price: 0, scheduledStartMs: soon, agreementRequired: false, paymentRequired: false, createdAt: now },
        { id: 'i-paid', tenantId: T, propertyAddress: '2 St', date: '2099-08-07', status: 'confirmed',
          paymentStatus: 'paid', price: 45000, scheduledStartMs: soon, agreementRequired: false, paymentRequired: true, createdAt: now },
    ] as never);
    await db.insert(schema.invoices).values({
        id: 'inv-1', tenantId: T, inspectionId: 'i-paid', amountCents: 45000,
        lineItems: [{ description: 'Inspection', amountCents: 45000 }], createdAt: now,
    } as never);
    await recordPayment(db as never, T, {
        invoiceId: 'inv-1', inspectionId: 'i-paid', kind: 'balance', amountCents: 45000,
        method: 'card', provider: 'stripe', providerRef: 'pi_1',
    });
});

describe('GET /cancellation-quote', () => {
    it('positive control: a manager receives the full priced quote', async () => {
        const body = await (await quote(buildApp('manager'), 'i-paid')).json() as { data: { feeCents: number; refundCents: number } };
        expect(body.data.feeCents).toBeGreaterThan(0);
        expect(body.data.refundCents).toBeGreaterThan(0);
    });
    it('a caller without inspectionFees gets requiresFinancial and no amount at all', async () => {
        const res = await quote(buildApp('inspector', NO_FEES), 'i-paid');
        expect(res.status).toBe(200);
        const text = await res.text();
        expect(JSON.parse(text).data.requiresFinancial).toBe(true);
        expect(text).not.toMatch(MONEY_KEY);
    });
    it('the default inspector holds inspectionFees and receives the priced quote', async () => {
        const body = await (await quote(buildApp('inspector'), 'i-paid')).json() as { data: { feeCents: number } };
        expect(body.data.feeCents).toBeGreaterThan(0);
    });
    it('companyFinance alone does not unlock the quote', async () => {
        const res = await quote(buildApp('inspector', { inspectionFees: false, companyFinance: true }), 'i-paid');
        expect(JSON.parse(await res.text()).data.requiresFinancial).toBe(true);
    });
    it('says whether money is involved, so the dialog can offer a free cancellation', async () => {
        const free = await (await quote(buildApp('inspector', NO_FEES), 'i-free')).json() as { data: { moneyInvolved: boolean } };
        const paid = await (await quote(buildApp('inspector', NO_FEES), 'i-paid')).json() as { data: { moneyInvolved: boolean } };
        expect(free.data.moneyInvolved).toBe(false);
        expect(paid.data.moneyInvolved).toBe(true);
    });
});

describe('POST /cancel', () => {
    it('without inspectionFees, an inspection with no money attached cancels, and the answer carries no amount', async () => {
        const res = await cancel(buildApp('inspector', NO_FEES), 'i-free', { acknowledgedFeeCents: 0 });
        expect(res.status).toBe(200);
        expect(await res.text()).not.toMatch(MONEY_KEY);
        expect(await statusOf('i-free')).toBe('cancelled');
    });
    it('without inspectionFees, a paid inspection is refused with FINANCIAL_REQUIRED naming the capability, carries no amount, and stays uncancelled', async () => {
        const res = await cancel(buildApp('inspector', NO_FEES), 'i-paid', { acknowledgedFeeCents: 22500 });
        expect(res.status).toBe(403);
        const text = await res.text();
        expect(JSON.parse(text).error.code).toBe('FINANCIAL_REQUIRED');
        expect(JSON.parse(text).error.details).toMatchObject({ field: 'cancellation', capability: 'inspectionFees' });
        expect(text).not.toMatch(MONEY_KEY);
        expect(await statusOf('i-paid')).toBe('confirmed');
        const refunds = await db.select().from(schema.orderPayments).where(eq(schema.orderPayments.kind, 'refund')).all();
        expect(refunds).toHaveLength(0);
    });
    it('positive control: a manager cancels the paid inspection and sees the outcome', async () => {
        const res = await cancel(buildApp('manager'), 'i-paid', { acknowledgedFeeCents: 22500 });
        expect(res.status).toBe(200);
        expect(await res.text()).toMatch(MONEY_KEY);
        expect(await statusOf('i-paid')).toBe('cancelled');
    });
    it('an inspector with the default inspectionFees cancels the paid inspection', async () => {
        const res = await cancel(buildApp('inspector'), 'i-paid', { acknowledgedFeeCents: 22500 });
        expect(res.status).toBe(200);
    });
});
