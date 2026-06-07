import { Hono } from 'hono';
import { HonoConfig } from '../types/hono';
import { logger } from '../lib/logger';
import { extractSettledPayment } from '../lib/stripe-helpers';
import { appendWebhookLogEntry } from '../lib/stripe-webhook-log';
import { AppError } from '../lib/errors';

/**
 * Stripe webhook (bring-your-own-keys). Excluded from JWT middleware (see
 * index.ts `isPublic`); authenticity is proven by the `stripe-signature`
 * HMAC verified against the tenant's OWN webhook signing secret.
 *
 * Tenant resolution: the slug-scoped mount
 * `/api/integrations/stripe/webhook/:tenant` resolves the tenant via
 * PUBLIC_PREFIXES path-param resolution (saas + standalone); the bare legacy
 * mount still works in standalone via the fixed tenant. No tenant in scope →
 * fail-closed no-op.
 *
 * Processing is SYNCHRONOUS: two idempotent D1 updates, 500 on failure so
 * Stripe's own retry (exponential backoff, up to 3 days) is the durability
 * layer. Do NOT move the work into waitUntil — a background failure after a
 * 200 is unrecoverable (Stripe never re-sends an ACKed event).
 */
const api = new Hono<HonoConfig>();

api.post('/', async (c) => {
    const signature = c.req.header('stripe-signature');
    if (!signature) {
        logger.info('Stripe webhook: missing stripe-signature header');
        return c.json({ success: false, error: { message: 'Missing signature' } }, 401);
    }

    const tenantId = (c.get('tenantId') || c.get('resolvedTenantId')) as string | undefined;
    const env = c.env as unknown as Record<string, string | undefined>;
    const secretKey = env.STRIPE_SECRET_KEY;
    const webhookSecret = env.STRIPE_WEBHOOK_SECRET;
    if (!tenantId || !secretKey || !webhookSecret) {
        // No tenant on this path (bare URL in saas) or no keys configured —
        // nothing to verify against. Ack so Stripe stops retrying.
        logger.info('Stripe webhook: no tenant/keys in scope — ignoring');
        return c.json({ success: true });
    }

    // Raw body BEFORE any parsing — HMAC must cover the exact bytes Stripe signed.
    const rawBody = await c.req.text();

    let event;
    try {
        const { StripeService } = await import('../services/stripe.service');
        const svc = new StripeService(secretKey);
        event = await svc.verifyWebhook(rawBody, signature, webhookSecret);
    } catch (err) {
        await appendWebhookLogEntry(c.env.TENANT_CACHE, tenantId, {
            eventType: 'unknown', result: 'signature_failed',
        });
        logger.info('Stripe webhook: signature verification failed', {
            error: err instanceof Error ? err.message : String(err),
        });
        return c.json({ success: false, error: { message: 'Invalid signature' } }, 400);
    }

    const settled = extractSettledPayment(event);
    if (!settled) {
        // Verified but nothing to act on (includes Stripe dashboard "Send test
        // event" payloads) — the log row is the user's connectivity probe.
        await appendWebhookLogEntry(c.env.TENANT_CACHE, tenantId, {
            eventType: event.type, result: 'received',
        });
        return c.json({ success: true });
    }

    if (settled.tenantId !== tenantId) {
        // A hostile-but-valid Stripe account could stamp another tenant's id
        // into its own metadata; the signature only proves the PATH tenant.
        await appendWebhookLogEntry(c.env.TENANT_CACHE, tenantId, {
            eventType: event.type, result: 'tenant_mismatch',
        });
        logger.warn('Stripe webhook: metadata tenant does not match path tenant — discarded', {
            pathTenant: tenantId, metadataTenant: settled.tenantId,
        });
        return c.json({ success: true }); // ACK: a retry can never succeed
    }

    try {
        await c.var.services.invoice.markPaid(settled.invoiceId, tenantId, 'oi', 'card');
        if (settled.inspectionId) {
            await c.var.services.inspection.markPaymentReceived(tenantId, settled.inspectionId);
        }
    } catch (e) {
        if (e instanceof AppError && e.status === 404) {
            // Invoice purged/gone — retrying can never succeed; ack and move on.
            logger.warn('Stripe webhook: invoice not found — acked', { invoiceId: settled.invoiceId.slice(0, 8) });
            return c.json({ success: true });
        }
        logger.error('Stripe webhook processing error', {}, e instanceof Error ? e : undefined);
        return c.json({ success: false, error: { message: 'Processing failed' } }, 500);
    }

    await appendWebhookLogEntry(c.env.TENANT_CACHE, tenantId, {
        eventType: event.type, result: 'processed',
    });
    logger.info('Stripe webhook: invoice settled', {
        invoiceId: settled.invoiceId.slice(0, 8),
        inspectionId: settled.inspectionId?.slice(0, 8),
    });
    return c.json({ success: true });
});

export default api;
