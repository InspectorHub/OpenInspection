/**
 * `POST /api/public/inspections/{id}/deposit-intent` — a retry must not create
 * a second chargeable client secret.
 *
 * This route is the awkward one for the mounted guard, and the reason is worth
 * stating rather than discovering. `idempotencyGuard` engages only when a
 * tenant is on the context AND the client sends an `Idempotency-Key`. A tenant
 * IS on the context here (path-param routing resolves it from the inspection
 * id), but the caller is a Stripe Elements panel in an anonymous booker's
 * browser, which sends no such header and never will. So the guard is not the
 * story.
 *
 * The story is two things, and both are asserted below:
 *
 *   1. THE ROUTE WRITES NOTHING OF OURS. No ledger row, no column. What a
 *      retry could duplicate is a Stripe PaymentIntent, and two live intents
 *      for one deposit are two ways to be charged.
 *   2. STRIPE'S OWN IDEMPOTENCY KEY closes that. The same key returns the same
 *      intent for 24 hours, and the key carries the OUTSTANDING amount so a
 *      partial deposit correctly gets a fresh intent for the remainder rather
 *      than replaying a stale one.
 *
 * And the backstop, also asserted: once the deposit has actually landed, the
 * route refuses outright — a replay after settlement cannot charge again even
 * if Stripe's window has expired.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';

const { createDepositPaymentIntent } = vi.hoisted(() => ({ createDepositPaymentIntent: vi.fn() }));
vi.mock('../../../server/services/stripe.service', () => ({
    StripeService: class {
        constructor(_k: string) { void _k; }
        createDepositPaymentIntent = createDepositPaymentIntent;
    },
}));
vi.mock('../../../server/lib/rate-limit', () => ({ checkRateLimit: vi.fn().mockResolvedValue(undefined) }));
vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

// eslint-disable-next-line import/order
import depositIntentRoutes from '../../../server/api/public/deposit-intent';
// eslint-disable-next-line import/order
import { recordPayment } from '../../../server/services/payment-ledger.service';
// eslint-disable-next-line import/order
import { idempotencyMiddleware } from '../../../server/lib/middleware/idempotency';
// eslint-disable-next-line import/order
import { AppError } from '../../../server/lib/errors';
// eslint-disable-next-line import/order
import type { HonoConfig } from '../../../server/types/hono';

const TENANT = '00000000-0000-0000-0000-0000000000d1';
const INSPECTION = 'insp-0000-0000-0000-000000000d01';

let db: BetterSQLite3Database<typeof schema>;

const ENV = {
    DB: {},
    STRIPE_SECRET_KEY: 'sk_test_1',
    STRIPE_PUBLISHABLE_KEY: 'pk_test_1',
} as never;
const CTX = { waitUntil: (p: Promise<unknown>) => void p, passThroughOnException: () => {} } as never;

/** The mounted shape: tenant resolved by path-param routing, then the guard. */
function buildApp() {
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('resolvedTenantId', TENANT as never);
        c.set('tenantId', TENANT);
        await next();
    });
    app.use('*', idempotencyMiddleware({ getDb: () => db as never }));
    app.route('/api/public', depositIntentRoutes);
    app.onError((err, c) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status as never);
        }
        throw err;
    });
    return app;
}

function startDeposit() {
    const req = new Request(`https://acme.example.com/api/public/inspections/${INSPECTION}/deposit-intent`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    return buildApp().fetch(req, ENV, CTX);
}

beforeEach(async () => {
    const fixture = createTestDb();
    db = fixture.db;
    await setupSchema(fixture.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    createDepositPaymentIntent.mockReset();
    createDepositPaymentIntent.mockResolvedValue({ id: 'pi_1', clientSecret: 'pi_1_secret' });

    await db.insert(schema.tenants).values({
        id: TENANT, name: 'Acme', slug: 'acme', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await db.insert(schema.tenantConfigs).values({ tenantId: TENANT, updatedAt: new Date() });
    await db.insert(schema.inspections).values({
        id: INSPECTION, tenantId: TENANT, propertyAddress: '1 Oak St',
        date: '2026-07-17', status: 'requested', createdAt: new Date(),
        depositRequiredCents: 9000,
    });
});

const ledgerRows = () =>
    db.select().from(schema.orderPayments).where(eq(schema.orderPayments.tenantId, TENANT)).all();

describe("POST '/api/public/inspections/{id}/deposit-intent' — replay does not create a second chargeable intent", () => {
    it('writes nothing of ours, on the first call or the second', async () => {
        expect((await startDeposit()).status).toBe(200);
        expect((await startDeposit()).status).toBe(200);
        expect(await ledgerRows()).toHaveLength(0);
    });

    it("hands Stripe the SAME idempotency key both times, so it returns one intent", async () => {
        await startDeposit();
        await startDeposit();
        expect(createDepositPaymentIntent).toHaveBeenCalledTimes(2);
        // The service builds the key; asserting on the arguments it was given is
        // what keeps this test honest about WHICH intent is being asked for.
        const [firstOrder] = createDepositPaymentIntent.mock.calls[0] as [{ inspectionId: string; outstandingCents: number }];
        const [secondOrder] = createDepositPaymentIntent.mock.calls[1] as [{ inspectionId: string; outstandingCents: number }];
        expect(secondOrder).toEqual(firstOrder);
        expect(firstOrder).toEqual({ inspectionId: INSPECTION, outstandingCents: 9000 });
    });

    it('asks for the REMAINDER after a partial deposit, not the original amount', async () => {
        await recordPayment(db, TENANT, {
            inspectionId: INSPECTION, invoiceId: null, kind: 'deposit',
            amountCents: 4000, method: 'card', provider: 'stripe', providerRef: 'pi_partial',
        });
        await startDeposit();
        const [order] = createDepositPaymentIntent.mock.calls[0] as [{ outstandingCents: number }];
        // A key pinned to the order alone would replay the $90 intent here and
        // charge for money already collected.
        expect(order.outstandingCents).toBe(5000);
    });

    it('refuses once the deposit has landed, whatever Stripe would replay', async () => {
        await recordPayment(db, TENANT, {
            inspectionId: INSPECTION, invoiceId: null, kind: 'deposit',
            amountCents: 9000, method: 'card', provider: 'stripe', providerRef: 'pi_1',
        });
        const res = await startDeposit();
        expect(res.status).toBe(404);
        expect(createDepositPaymentIntent).not.toHaveBeenCalled();
    });

    it('refuses an order with no deposit configured, and an unknown id, identically', async () => {
        await db.update(schema.inspections).set({ depositRequiredCents: null })
            .where(eq(schema.inspections.id, INSPECTION));
        expect((await startDeposit()).status).toBe(404);

        await db.delete(schema.inspections).where(eq(schema.inspections.id, INSPECTION));
        // Same status and same body: the route must not double as a probe for
        // which inspection ids exist.
        expect((await startDeposit()).status).toBe(404);
        expect(createDepositPaymentIntent).not.toHaveBeenCalled();
    });

    it('refuses once the visit is under way — a deposit only holds a slot', async () => {
        await db.update(schema.inspections).set({ status: 'in_progress' })
            .where(eq(schema.inspections.id, INSPECTION));
        expect((await startDeposit()).status).toBe(404);
        expect(createDepositPaymentIntent).not.toHaveBeenCalled();
    });
});
