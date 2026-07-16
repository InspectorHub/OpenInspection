/**
 * i18n Phase B — the PaymentIntent a tenant's Stripe account charges is minted
 * in the INVOICE's snapshot currency (Stripe lowercases it, e.g. 'cad'), not a
 * hardcoded USD. Guards the service -> Stripe SDK boundary: `ctx.currency` must
 * reach `paymentIntents.create({ currency })`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const createPaymentIntent = vi.fn(async () => ({ id: 'pi_1', client_secret: 'cs_1' }));

vi.mock('stripe', () => {
    class FakeStripe {
        paymentIntents = { create: createPaymentIntent };
        static createFetchHttpClient() { return {}; }
        static createSubtleCryptoProvider() { return {}; }
    }
    return { default: FakeStripe };
});

// Imported AFTER the mock is registered so the fake Stripe is wired in.
const { StripeService } = await import('../../../server/services/stripe.service');

describe('StripeService.createPaymentIntent — currency forwarding', () => {
    beforeEach(() => createPaymentIntent.mockClear());

    const invoice = { id: 'inv_1', amountCents: 50000, inspectionId: 'insp_1', status: 'sent' as const };

    it('charges in the invoice snapshot currency, lowercased (CAD -> cad)', async () => {
        const svc = new StripeService('sk_test_x');
        await svc.createPaymentIntent(invoice, { tenantId: 't_1', currency: 'CAD' });
        expect(createPaymentIntent).toHaveBeenCalledTimes(1);
        expect(createPaymentIntent.mock.calls[0][0]).toMatchObject({ amount: 50000, currency: 'cad' });
    });

    it('defaults to usd when no currency is supplied', async () => {
        const svc = new StripeService('sk_test_x');
        await svc.createPaymentIntent(invoice, { tenantId: 't_1' });
        expect(createPaymentIntent.mock.calls[0][0]).toMatchObject({ currency: 'usd' });
    });
});
