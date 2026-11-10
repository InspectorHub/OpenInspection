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
import { buildPaymentIntentParams, buildDepositIntentParams, type PayableInvoice } from '../lib/stripe-helpers';

/** PaymentIntent statuses a customer can still pay. Anything else (succeeded, canceled) is over. */
const LIVE_INTENT_STATUSES: ReadonlySet<string> = new Set([
    'requires_payment_method', 'requires_confirmation', 'requires_action', 'processing',
]);

/** How many replacement intents one balance may have gone through (pay, refund, pay, refund ...). */
const MAX_KEY_ATTEMPTS = 5;

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
        // Reaching the key below means `buildPaymentIntentParams` accepted a positive outstanding
        // amount, so a fresh intent is never minted for an invoice that owes nothing.
        // A double click, or a retry, must not mint a second chargeable intent for the same balance.
        // The amount is part of the key, so a balance that has moved gets a new intent and the same
        // balance gets the same one. Mirrors the deposit key below.
        return this.createLiveIntent(params, `oi-invoice:${ctx.tenantId}:${invoice.id}:${params.amount}`);
    }

    /**
     * Creates a PaymentIntent for a booking DEPOSIT — money against an order
     * with no invoice behind it. Throws DepositNotPayableError when nothing is
     * outstanding, so a double-submit or a race with the webhook cannot charge
     * a second deposit.
     *
     * RETRY SAFETY LIVES HERE, not in the middleware. The route that calls this
     * is public and its caller is a payment panel that sends no
     * `Idempotency-Key`, so `idempotencyGuard` never engages — and the route
     * writes no row of ours, which means the thing a retry could duplicate is
     * a PAYMENT INTENT. Two live intents for one deposit is two chargeable
     * client secrets. Stripe's own idempotency key removes that: the same key
     * returns the SAME intent for 24 hours.
     *
     * The key includes the OUTSTANDING amount deliberately. Once a partial
     * deposit lands, the remainder is a different charge and must get a
     * different intent — pinning the key to the order alone would replay a stale
     * intent for money already collected.
     */
    async createDepositPaymentIntent(
        order: { inspectionId: string; outstandingCents: number },
        ctx: { tenantId: string; currency?: string; descriptionPrefix?: string },
    ): Promise<{ id: string; clientSecret: string }> {
        const params = buildDepositIntentParams(order, ctx);
        return this.createLiveIntent(params, `oi-deposit:${ctx.tenantId}:${order.inspectionId}:${order.outstandingCents}`);
    }

    /**
     * Creates the intent under `baseKey`, which Stripe replays for 24 hours: a repeat call
     * for the same balance returns the same intent, so a double click is one charge path.
     *
     * A replay is only useful while the intent can still be paid. If the replayed intent has
     * ended (it succeeded and was later refunded so the same amount is owed again, or it was
     * cancelled), its client secret cannot be confirmed and the customer would be locked out for
     * a day. Then ONE new intent is minted under a key with an attempt component. Only
     * requires_payment_method, requires_confirmation, requires_action and processing are live.
     * The caller has already established that a positive amount is owed.
     */
    private async createLiveIntent(
        params: { amount: number; currency: string; description: string; metadata: Record<string, string> },
        baseKey: string,
    ): Promise<{ id: string; clientSecret: string }> {
        const create = (idempotencyKey: string) => this.stripe.paymentIntents.create({
            amount: params.amount,
            currency: params.currency,
            automatic_payment_methods: { enabled: true },
            description: params.description,
            metadata: params.metadata,
        }, { idempotencyKey });
        // Walk a deterministic ladder of keys: the base key, then base:r1, base:r2 ... and stop
        // at the first intent that can still be paid. A random suffix would mint a NEW chargeable
        // intent on every click once the base-key intent had ended; this way a double click or a
        // reload replays the same replacement.
        let intent = await create(baseKey);
        for (let attempt = 1; attempt <= MAX_KEY_ATTEMPTS; attempt += 1) {
            // Stripe replays the response stored at creation, so its `status` is frozen at
            // requires_payment_method; read the intent's current state before trusting it.
            const current = await this.stripe.paymentIntents.retrieve(intent.id);
            if (current.status === undefined || LIVE_INTENT_STATUSES.has(current.status)) break;
            if (attempt === MAX_KEY_ATTEMPTS) {
                throw new Error('Stripe returned only ended payment intents for this balance');
            }
            intent = await create(`${baseKey}:r${attempt}`);
        }
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

    /**
     * Verifies the secret key is alive by fetching its own account.
     * Used by save-time validation and the settings "Test connection" button.
     * Mode (test/live) is inferred from the key prefix by callers — the
     * Account API does not reliably expose livemode.
     */
    async getAccount(): Promise<{ accountName: string }> {
        // Pass `null` to retrieve the account that owns the API key in use
        // (this SDK version requires the id argument; null = own account).
        const acct = await this.stripe.accounts.retrieve(null);
        return {
            accountName: acct.settings?.dashboard?.display_name || acct.email || acct.id,
        };
    }

    /** The own-account capability flags the "Test connection" steps report on. */
    async getAccountStatus(): Promise<{ accountName: string; chargesEnabled: boolean; payoutsEnabled: boolean; detailsSubmitted: boolean }> {
        const acct = await this.stripe.accounts.retrieve(null);
        return {
            accountName: acct.settings?.dashboard?.display_name || acct.email || acct.id,
            chargesEnabled: acct.charges_enabled === true,
            payoutsEnabled: acct.payouts_enabled === true,
            detailsSubmitted: acct.details_submitted === true,
        };
    }
}
