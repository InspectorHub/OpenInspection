/**
 * Stripe replays the stored response for an idempotency key for 24 hours. That protects a
 * double click (same balance, same intent) but must not lock a customer out: when the
 * replayed intent has ended, ONE new intent is minted. The fake below behaves like Stripe:
 * the first call under a key stores an intent, later calls under that key return it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Stored = { id: string; client_secret: string; status: string };
const store = new Map<string, Stored>();
let seq = 0;
const create = vi.fn(async (_params: { amount: number }, options: { idempotencyKey: string }) => {
    const hit = store.get(options.idempotencyKey);
    // Stripe replays the response stored at creation, NOT the intent's current state.
    if (hit) return { ...hit, status: 'requires_payment_method' };
    seq += 1;
    const intent = { id: `pi_${seq}`, client_secret: `cs_${seq}`, status: 'requires_payment_method' };
    store.set(options.idempotencyKey, intent);
    return { ...intent };
});
const retrieve = vi.fn(async (id: string) => {
    const live = [...store.values()].find((v) => v.id === id);
    if (!live) throw new Error('no such intent');
    return { ...live };
});

vi.mock('stripe', () => {
    class FakeStripe {
        paymentIntents = { create, retrieve };
        static createFetchHttpClient() { return {}; }
        static createSubtleCryptoProvider() { return {}; }
    }
    return { default: FakeStripe };
});

const { StripeService } = await import('../../../server/services/stripe.service');

const invoice = { id: 'inv_1', amountCents: 45000, outstandingCents: 45000, inspectionId: 'insp_1', status: 'sent' };
const ctx = { tenantId: 't_1' };
const endOne = (id: string, status: string) => { for (const v of store.values()) if (v.id === id) v.status = status; };
const endAll = (status: string) => { for (const v of store.values()) v.status = status; };

beforeEach(() => { store.clear(); create.mockClear(); seq = 0; });

describe('invoice intent replay', () => {
    it('same balance twice: one intent, same id (a double click is one charge path)', async () => {
        const svc = new StripeService('sk_test_x');
        const a = await svc.createPaymentIntent(invoice, ctx);
        const b = await svc.createPaymentIntent(invoice, ctx);
        expect(b.id).toBe(a.id);
        expect(store.size).toBe(1);
    });

    it('the first intent succeeded and the same balance is owed again: a NEW intent', async () => {
        const svc = new StripeService('sk_test_x');
        const a = await svc.createPaymentIntent(invoice, ctx);
        endAll('succeeded');
        const b = await svc.createPaymentIntent(invoice, ctx);
        expect(b.id).not.toBe(a.id);
        expect(b.clientSecret).toBe(`cs_${seq}`);
        // The replacement is itself replayed on a double click or a reload: the SAME intent,
        // not a third one (a random retry key would mint a chargeable intent per click).
        expect((await svc.createPaymentIntent(invoice, ctx)).id).toBe(b.id);
        expect((await svc.createPaymentIntent(invoice, ctx)).id).toBe(b.id);
        expect(store.size).toBe(2);
    });

    it('pay, refund, pay, refund: each cycle gets one new intent and a double click still replays it', async () => {
        const svc = new StripeService('sk_test_x');
        const a = await svc.createPaymentIntent(invoice, ctx);
        endOne(a.id, 'succeeded');
        const b = await svc.createPaymentIntent(invoice, ctx);
        endOne(b.id, 'succeeded');
        const c = await svc.createPaymentIntent(invoice, ctx);
        expect(new Set([a.id, b.id, c.id]).size).toBe(3);
        expect((await svc.createPaymentIntent(invoice, ctx)).id).toBe(c.id);
        expect(store.size).toBe(3);
    });

    it('gives up loudly instead of minting intents forever when every one has ended', async () => {
        const svc = new StripeService('sk_test_x');
        const originalCreate = create.getMockImplementation()!;
        create.mockImplementation(async (params, options) => {
            const intent = await originalCreate(params, options);
            endOne(intent.id, 'canceled');
            return { ...intent };
        });
        await expect(svc.createPaymentIntent(invoice, ctx)).rejects.toThrow(/only ended/);
        expect(store.size).toBeLessThanOrEqual(5);
        create.mockImplementation(originalCreate);
    });

    it('a cancelled replay: a new intent', async () => {
        const svc = new StripeService('sk_test_x');
        const a = await svc.createPaymentIntent(invoice, ctx);
        endAll('canceled');
        expect((await svc.createPaymentIntent(invoice, ctx)).id).not.toBe(a.id);
    });

    it.each(['requires_action', 'processing', 'requires_confirmation'])('a %s replay is still live and returned as is', async (status) => {
        const svc = new StripeService('sk_test_x');
        const a = await svc.createPaymentIntent(invoice, ctx);
        endAll(status);
        expect((await svc.createPaymentIntent(invoice, ctx)).id).toBe(a.id);
    });

    it('nothing outstanding never reaches Stripe', async () => {
        const svc = new StripeService('sk_test_x');
        await expect(svc.createPaymentIntent({ ...invoice, outstandingCents: 0 }, ctx)).rejects.toThrow();
        expect(create).not.toHaveBeenCalled();
    });
});

describe('deposit intent replay', () => {
    const order = { inspectionId: 'insp_1', outstandingCents: 9000 };

    it('same outstanding twice: the same intent', async () => {
        const svc = new StripeService('sk_test_x');
        const a = await svc.createDepositPaymentIntent(order, ctx);
        expect((await svc.createDepositPaymentIntent(order, ctx)).id).toBe(a.id);
    });

    it('the first deposit intent succeeded and the same amount is owed again: a NEW intent', async () => {
        const svc = new StripeService('sk_test_x');
        const a = await svc.createDepositPaymentIntent(order, ctx);
        endAll('succeeded');
        expect((await svc.createDepositPaymentIntent(order, ctx)).id).not.toBe(a.id);
    });
});
