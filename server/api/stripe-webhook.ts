import { Hono } from 'hono';
import { HonoConfig } from '../types/hono';
import { logger } from '../lib/logger';
import { extractSettledPayment } from '../lib/stripe-helpers';

/**
 * Stripe webhook (bring-your-own-keys). Excluded from JWT middleware (see
 * index.ts `isPublic`); authenticity is proven by the `stripe-signature`
 * HMAC verified against the tenant's OWN webhook signing secret.
 *
 * Per-tenant routing: the tenant is resolved from the request slug by
 * tenantRouter, and integration-secrets middleware loads THAT tenant's
 * STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET into c.env. So each inspector
 * points their Stripe dashboard webhook at their own slug and we verify
 * with their own secret.
 */
const api = new Hono<HonoConfig>();

api.post('/', async (c) => {
    const signature = c.req.header('stripe-signature');
    if (!signature) {
        logger.info('Stripe webhook: missing stripe-signature header');
        return c.json({ success: false, error: { message: 'Missing signature' } }, 401);
    }

    const env = c.env as unknown as Record<string, string | undefined>;
    const secretKey = env.STRIPE_SECRET_KEY;
    const webhookSecret = env.STRIPE_WEBHOOK_SECRET;
    if (!secretKey || !webhookSecret) {
        // Tenant hasn't configured Stripe — nothing to verify against. Ack so
        // Stripe stops retrying; this endpoint is a no-op for them.
        logger.info('Stripe webhook: tenant has no Stripe keys configured — ignoring');
        return c.json({ success: true });
    }

    // Read the raw body BEFORE any parsing — HMAC must use the exact bytes Stripe signed.
    const rawBody = await c.req.text();

    let event;
    try {
        const { StripeService } = await import('../services/stripe.service');
        const svc = new StripeService(secretKey);
        event = await svc.verifyWebhook(rawBody, signature, webhookSecret);
    } catch (err) {
        logger.info('Stripe webhook: signature verification failed', {
            error: err instanceof Error ? err.message : String(err),
        });
        return c.json({ success: false, error: { message: 'Invalid signature' } }, 400);
    }

    const settled = extractSettledPayment(event);
    if (!settled) {
        // Not a payment we act on (e.g. payment_intent.created) — ack and move on.
        return c.json({ success: true });
    }

    const invoiceSvc = c.var.services.invoice;
    const inspectionSvc = c.var.services.inspection;

    // Respond 200 immediately; Stripe retries on non-200, so do the DB work in
    // the background. markPaid flips invoice.paidAt (receipt + earnings);
    // markPaymentReceived flips inspections.paymentStatus (closes the report gate).
    c.executionCtx.waitUntil(
        (async () => {
            await invoiceSvc.markPaid(settled.invoiceId, settled.tenantId, 'oi', 'card');
            if (settled.inspectionId) {
                await inspectionSvc.markPaymentReceived(settled.tenantId, settled.inspectionId);
            }
            logger.info('Stripe webhook: invoice settled', {
                invoiceId: settled.invoiceId.slice(0, 8),
                inspectionId: settled.inspectionId?.slice(0, 8),
            });
        })().catch((e) => {
            logger.error('Stripe webhook processing error', {}, e instanceof Error ? e : undefined);
        }),
    );

    return c.json({ success: true });
});

export default api;
