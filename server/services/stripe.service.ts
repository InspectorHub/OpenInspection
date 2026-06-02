/**
 * StripeService — bring-your-own-keys payment integration.
 *
 * Each tenant connects THEIR OWN Stripe account (test or live); the secret
 * key is loaded per-request from the tenant's encrypted secrets and merged
 * into c.env by integration-secrets middleware. The platform never registers
 * as a payment entity — see docs reference-invoice-payment-flow.
 *
 * Cloudflare Workers compatibility: the Stripe SDK is configured with
 * `createFetchHttpClient()` (no Node http) and webhook verification uses
 * `createSubtleCryptoProvider()` (Web Crypto, async) — the only combination
 * that runs on the V8-isolate runtime.
 */
import Stripe from 'stripe';
import { buildPaymentIntentParams, type PayableInvoice } from '../lib/stripe-helpers';

export class StripeService {
    private stripe: Stripe;

    constructor(secretKey: string) {
        this.stripe = new Stripe(secretKey, {
            httpClient: Stripe.createFetchHttpClient(),
            // Pin to the SDK's bundled API version (omit to avoid drift).
            maxNetworkRetries: 1,
            appInfo: { name: 'OpenInspection', url: 'https://inspectorhub.io' },
        });
    }

    /**
     * Creates a PaymentIntent for an invoice and returns the client secret the
     * browser needs to confirm the card via Stripe Elements. Throws
     * InvoiceNotPayableError (from stripe-helpers) for already-paid / $0 invoices.
     */
    async createPaymentIntent(
        invoice: PayableInvoice,
        ctx: { tenantId: string; currency?: string; descriptionPrefix?: string },
    ): Promise<{ id: string; clientSecret: string }> {
        const params = buildPaymentIntentParams(invoice, ctx);
        const intent = await this.stripe.paymentIntents.create({
            amount: params.amount,
            currency: params.currency,
            automatic_payment_methods: { enabled: true },
            description: params.description,
            metadata: params.metadata,
        });
        if (!intent.client_secret) {
            throw new Error('Stripe did not return a client secret');
        }
        return { id: intent.id, clientSecret: intent.client_secret };
    }

    /**
     * Verifies and parses a Stripe webhook payload against the tenant's
     * webhook signing secret. Uses the async SubtleCrypto verifier required
     * in Workers. Throws if the signature is invalid.
     */
    async verifyWebhook(rawBody: string, signature: string, webhookSecret: string): Promise<Stripe.Event> {
        return this.stripe.webhooks.constructEventAsync(
            rawBody,
            signature,
            webhookSecret,
            undefined,
            Stripe.createSubtleCryptoProvider(),
        );
    }
}
