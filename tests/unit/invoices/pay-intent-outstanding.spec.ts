/**
 * A client is charged what is still OWED on an invoice, never its total.
 *
 * A booking deposit is applied to the invoice raised later, and the payment
 * ledger then shows part (or all) of the total as received. The card pay page
 * used to charge `invoice.amountCents` regardless, so a client who had paid a
 * deposit was asked for the whole fee again. These tests drive the REAL public
 * pay-intent route against a real ledger, with only the Stripe SDK faked, and
 * then the webhook settle path that records what Stripe actually took.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import { asAnyDb, asD1Db } from '../helpers/test-db';
import { lazyD1 } from '../helpers/d1-binding';
import type { HonoConfig } from '../../../server/types/hono';

const createIntent = vi.fn(
    async (_params: { amount: number; currency: string; metadata: Record<string, string>; [k: string]: unknown }, _options?: { idempotencyKey: string }) => ({
        id: 'pi_new', client_secret: 'cs_new',
    }),
);
vi.mock('stripe', () => {
    class FakeStripe {
        paymentIntents = { create: createIntent, retrieve: async (id: string) => ({ id, status: "requires_payment_method" }) };
        static createFetchHttpClient() { return {}; }
        static createSubtleCryptoProvider() { return {}; }
    }
    return { default: FakeStripe };
});

const testD1 = lazyD1();
// eslint-disable-next-line import/order
import publicReportRoutes from '../../../server/api/public-report';
import { InvoiceService } from '../../../server/services/invoice.service';
import { PortalAccessService } from '../../../server/services/portal-access.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import { logger } from '../../../server/lib/logger';
import { recordPayment, getOutstandingCents } from '../../../server/services/payment-ledger.service';

const TENANT = '00000000-0000-0000-0000-0000000000c1';
const OTHER = '00000000-0000-0000-0000-0000000000c2';
const SECRET = 'test-jwt-secret';
const INSP = 'insp-0000-0000-0000-0000000000c1';

let db: BetterSQLite3Database<typeof schema>;
let portalAccess: PortalAccessService;
let invoiceSvc: InvoiceService;

function buildApp(routedTenant: string = TENANT, extraEnv: Record<string, string> = { STRIPE_WEBHOOK_SECRET: 'whsec_test' }, selfHost = true) {
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        (c as unknown as { env: Record<string, unknown> }).env = {
            DB: testD1.binding, JWT_SECRET: SECRET,
            STRIPE_SECRET_KEY: 'sk_test', STRIPE_PUBLISHABLE_KEY: 'pk_test', ...extraEnv,
        };
        c.set('profile', { envCredentialsAreCompanyOwn: selfHost } as never);
        c.set('resolvedTenantId', routedTenant as never);
        c.set('services', { portalAccess, invoice: invoiceSvc, branding: { getBrand: vi.fn().mockResolvedValue({ companyName: 'Acme', logoUrl: null, primaryColor: null, defaultTimezone: 'UTC' }) } } as unknown as HonoConfig['Variables']['services']);
        await next();
    });
    app.route('/api/public', publicReportRoutes);
    return app;
}

beforeEach(async () => {
    createIntent.mockClear();
    const fix = createTestDb();
    db = fix.db;
    await setupSchema(fix.sqlite);
    testD1.use(db);
    for (const [id, slug] of [[TENANT, 'acme'], [OTHER, 'other']] as const) {
        await db.insert(schema.tenants).values({
            id, slug, status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await db.insert(schema.tenantConfigs).values({ tenantId: id, updatedAt: new Date() });
    }
    await seedRoleProfiles(asD1Db(db), TENANT);
    await db.insert(schema.inspections).values({
        id: INSP, tenantId: TENANT, propertyAddress: '1 Oak St', date: '2026-07-17', createdAt: new Date(),
    });
    portalAccess = new PortalAccessService(testD1.binding, { jwtSecret: SECRET });
    invoiceSvc = new InvoiceService(testD1.binding);
});

const deposit = (amountCents: number, ref: string) =>
    recordPayment(asAnyDb(db), TENANT, {
        inspectionId: INSP, invoiceId: null, kind: 'deposit', amountCents,
        method: 'card', provider: 'stripe', providerRef: ref,
    });

const raiseInvoice = (amountCents: number) =>
    invoiceSvc.createInvoice(TENANT, {
        inspectionId: INSP, clientName: 'Dana', amountCents,
        lineItems: [{ description: 'Inspection', amountCents }],
    });

async function payIntent() {
    const token = await portalAccess.issueToken({
        tenantId: TENANT, inspectionId: INSP, recipientEmail: 'dana@example.com', role: 'client',
    });
    const res = await buildApp().request(`/api/public/inspections/${INSP}/pay-intent?token=${token}`, { method: 'POST' });
    return { res, body: await res.json() as { data?: { amountCents: number }; error?: { code: string } } };
}

describe('pay-intent charges the outstanding balance', () => {
    it('no payments yet: the full total', async () => {
        await raiseInvoice(45000);
        const { res, body } = await payIntent();
        expect(res.status).toBe(200);
        expect(createIntent.mock.calls[0]![0].amount).toBe(45000);
        expect(body.data!.amountCents).toBe(45000);
    });

    it('deposit then a later invoice: only the remainder is charged, and the page is told the same figure', async () => {
        await deposit(9000, 'pi_dep');
        await raiseInvoice(45000);
        const { res, body } = await payIntent();
        expect(res.status).toBe(200);
        expect(createIntent).toHaveBeenCalledTimes(1);
        expect(createIntent.mock.calls[0]![0].amount).toBe(36000);
        expect(body.data!.amountCents).toBe(36000);
    });

    it('deposit plus a part-payment: both come off', async () => {
        await deposit(9000, 'pi_dep');
        const inv = await raiseInvoice(45000);
        await recordPayment(asAnyDb(db), TENANT, {
            inspectionId: INSP, invoiceId: inv.id, kind: 'balance', amountCents: 10000, method: 'cash',
        });
        const { body } = await payIntent();
        expect(createIntent.mock.calls[0]![0].amount).toBe(26000);
        expect(body.data!.amountCents).toBe(26000);
    });

    it('a refund reduces the net received, so it is owed again', async () => {
        await deposit(9000, 'pi_dep');
        const inv = await raiseInvoice(45000);
        await recordPayment(asAnyDb(db), TENANT, {
            inspectionId: INSP, invoiceId: inv.id, kind: 'refund', amountCents: 4000, method: 'card',
            provider: 'stripe', providerRef: 're_1',
        });
        await payIntent();
        expect(createIntent.mock.calls[0]![0].amount).toBe(40000);
    });

    it('deposit equal to the total: not payable, and no PaymentIntent is created', async () => {
        await deposit(45000, 'pi_dep');
        const inv = await raiseInvoice(45000);
        const { res, body } = await payIntent();
        expect(res.status).toBe(409);
        expect(body.error!.code).toBe('INVOICE_NOT_PAYABLE');
        expect(createIntent).not.toHaveBeenCalled();
        // The ledger covers it, and the invoice says so; the inspection stays as it was.
        const row = await db.select().from(schema.invoices).where(eq(schema.invoices.id, inv.id)).get();
        expect(row!.paidAt).not.toBeNull();
    });

    it('a second attempt after another payment landed charges the new, smaller balance', async () => {
        const inv = await raiseInvoice(45000);
        await payIntent();
        expect(createIntent.mock.calls[0]![0].amount).toBe(45000);
        await recordPayment(asAnyDb(db), TENANT, {
            inspectionId: INSP, invoiceId: inv.id, kind: 'balance', amountCents: 20000, method: 'cash',
        });
        await payIntent();
        expect(createIntent.mock.calls[1]![0].amount).toBe(25000);
    });

    it("never counts another tenant's payments for the same inspection id", async () => {
        await raiseInvoice(45000);
        await recordPayment(asAnyDb(db), OTHER, {
            inspectionId: INSP, invoiceId: null, kind: 'deposit', amountCents: 9000,
            method: 'card', provider: 'stripe', providerRef: 'pi_other',
        });
        await payIntent();
        expect(createIntent.mock.calls[0]![0].amount).toBe(45000);
        const inv = await invoiceSvc.findByInspectionId(TENANT, INSP);
        expect(await getOutstandingCents(asAnyDb(db), OTHER, inv!)).toBe(45000);
    });
});

describe('the invoice the pay page reads carries the same balance', () => {
    it('balanceDueCents is the total minus the deposit, from the same definition the charge uses', async () => {
        await deposit(9000, 'pi_dep');
        await raiseInvoice(45000);
        const token = await portalAccess.issueToken({
            tenantId: TENANT, inspectionId: INSP, recipientEmail: 'dana@example.com', role: 'client',
        });
        const res = await buildApp().request(`/api/public/inspections/${INSP}/invoice?token=${token}`);
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { amountCents: number; balanceDueCents: number } };
        expect(body.data.amountCents).toBe(45000);
        expect(body.data.balanceDueCents).toBe(36000);
    });
});

describe('pay-intent needs the same complete key set as the booking page', () => {
    async function payWith(extraEnv: Record<string, string>, profile = true) {
        await raiseInvoice(45000);
        const token = await portalAccess.issueToken({
            tenantId: TENANT, inspectionId: INSP, recipientEmail: 'dana@example.com', role: 'client',
        });
        const app = buildApp(TENANT, extraEnv, profile);
        return app.request(`/api/public/inspections/${INSP}/pay-intent?token=${token}`, { method: 'POST' });
    }

    it('no webhook secret: 503 and no PaymentIntent (a payment could be taken and never recorded)', async () => {
        const res = await payWith({});
        expect(res.status).toBe(503);
        expect(createIntent).not.toHaveBeenCalled();
    });

    it('self-host with all three keys in the environment only: allowed', async () => {
        const res = await payWith({ STRIPE_WEBHOOK_SECRET: 'whsec_env' });
        expect(res.status).toBe(200);
        expect(createIntent).toHaveBeenCalledTimes(1);
    });

    it('hosted deployment: keys in the deployment environment are never the company own, so 503', async () => {
        const res = await payWith({ STRIPE_WEBHOOK_SECRET: 'whsec_env' }, false);
        expect(res.status).toBe(503);
        expect(createIntent).not.toHaveBeenCalled();
    });
});

describe('the webhook settle path records what Stripe took', () => {
    it('records the settled amount against the invoice, once, even when the invoice is already paid', async () => {
        const inv = await raiseInvoice(45000);
        await recordPayment(asAnyDb(db), TENANT, {
            inspectionId: INSP, invoiceId: inv.id, kind: 'balance', amountCents: 45000, method: 'cash',
        });
        // A stale intent (created before the cash landed) is confirmed afterwards.
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
        const first = await invoiceSvc.markPaid(inv.id, TENANT, 'oi', 'card', { amountCents: 45000, providerRef: 'pi_stale' });
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0]![0]).toMatch(/overpayment/);
        warn.mockRestore();
        expect(first).not.toBeNull();
        expect(first!.amountCents).toBe(45000);
        // Redelivery of the same event appends nothing.
        expect(await invoiceSvc.markPaid(inv.id, TENANT, 'oi', 'card', { amountCents: 45000, providerRef: 'pi_stale' })).toBeNull();

        const rows = await db.select().from(schema.orderPayments).where(eq(schema.orderPayments.invoiceId, inv.id)).all();
        expect(rows).toHaveLength(2);
        // The overpayment is visible, so the owner can refund it.
        expect(await getOutstandingCents(asAnyDb(db), TENANT, inv)).toBe(0);
        const stored = await db.select().from(schema.invoices).where(eq(schema.invoices.id, inv.id)).get();
        expect(stored!.amountPaidCents).toBe(90000);
    });

    it('creates the invoice intent with a key made of tenant, invoice and balance, so a double click returns one intent', async () => {
        const inv = await raiseInvoice(45000);
        await payIntent();
        await payIntent();
        const opts = createIntent.mock.calls.map((c) => c[1]!);
        expect(opts[0]!.idempotencyKey).toBe(`oi-invoice:${TENANT}:${inv.id}:45000`);
        expect(opts[1]!.idempotencyKey).toBe(opts[0]!.idempotencyKey);
        await recordPayment(asAnyDb(db), TENANT, {
            inspectionId: INSP, invoiceId: inv.id, kind: 'balance', amountCents: 5000, method: 'cash',
        });
        await payIntent();
        expect(createIntent.mock.calls[2]![1]!.idempotencyKey).toBe(`oi-invoice:${TENANT}:${inv.id}:40000`);
    });

    it('a normal remainder payment settles the invoice for exactly the charged amount', async () => {
        await deposit(9000, 'pi_dep');
        const inv = await raiseInvoice(45000);
        const appended = await invoiceSvc.markPaid(inv.id, TENANT, 'oi', 'card', { amountCents: 36000, providerRef: 'pi_ok' });
        expect(appended!.amountCents).toBe(36000);
        const stored = await db.select().from(schema.invoices).where(eq(schema.invoices.id, inv.id)).get();
        expect(stored!.paidAt).not.toBeNull();
        expect(stored!.amountPaidCents).toBe(45000);
    });
});
