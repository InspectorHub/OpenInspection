import { Hono } from 'hono';
import type { HonoConfig } from '../types/hono';
import { logger } from '../lib/logger';
import { extractSettledPayment } from '../lib/stripe-helpers';
import { appendWebhookLogEntry } from '../lib/stripe-webhook-log';
import { AppError } from '../lib/errors';
import { qboPaymentKey } from '../lib/qbo-payment-key';
import { recordPayment } from '../services/payment-ledger.service';
import { getDrizzle } from '../lib/route-helpers';

/**
 * Stripe webhook (bring-your-own-keys). Excluded from JWT middleware (see
 * index.ts `isPublic`); authenticity is proven by the `stripe-signature`
 * HMAC verified against the tenant's OWN webhook signing secret.
 *
 * Tenant resolution: the slug-scoped mount `/webhooks/stripe/:tenant` resolves
 * the tenant via PUBLIC_PREFIXES path-param resolution (saas + standalone); the
 * bare `/webhooks/stripe` mount still works in standalone via the fixed tenant.
 * No tenant in scope → fail-closed no-op.
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
    const env = c.env;
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
        //
        // An intent that carries a `kind` this build does not know is a
        // DIFFERENT thing, and the difference matters: that is our own money
        // going unrecorded, not a stray event. It still ACKs — a retry cannot
        // teach this worker a kind it was not built with — but it says so
        // where someone will see it.
        const kind = (event.data?.object as { metadata?: Record<string, string> | null } | undefined)?.metadata?.kind;
        if (kind && kind !== 'invoice' && kind !== 'deposit') {
            logger.error('Stripe webhook: unrecognised payment kind — money settled with no ledger row', { kind });
        }
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

    // A DEPOSIT is money against the ORDER with no invoice behind it, so it
    // takes neither of the two writes below: there is no invoice to mark paid,
    // and marking the inspection "payment received" would unlock a report the
    // client has paid a fraction of. The row is written HERE and nowhere else
    // — the browser reporting success is not a payment authority, and a
    // client-side write would record a declined card as collected.
    if (settled.purpose.kind === 'deposit') {
        try {
            const appendedDeposit = await recordPayment(getDrizzle(c), tenantId, {
                inspectionId: settled.purpose.inspectionId,
                invoiceId:    null,
                kind:         'deposit',
                amountCents:  settled.amountCents,
                method:       'card',
                provider:     'stripe',
                providerRef:  settled.providerRef,
            });
            await appendWebhookLogEntry(c.env.TENANT_CACHE, tenantId, {
                eventType: event.type, result: 'processed',
            });
            // Null is a redelivery of a row we already have — the unique index
            // on (tenant, provider, provider_ref) is the guard, and it is doing
            // its job. Not an error, and not a second deposit.
            logger.info('Stripe webhook: booking deposit settled', {
                inspectionId: settled.purpose.inspectionId.slice(0, 8),
                appended: appendedDeposit !== null,
            });
            // NOT pushed to QuickBooks. An unapplied deposit is a liability in
            // the tenant's own chart of accounts, and which account is their
            // accountant's decision — see the QBO Books health card, which
            // counts these and says they are unsynced rather than pretending.
            return c.json({ success: true });
        } catch (e) {
            logger.error('Stripe webhook: deposit processing error', {}, e instanceof Error ? e : undefined);
            return c.json({ success: false, error: { message: 'Processing failed' } }, 500);
        }
    }

    const invoiceId = settled.purpose.invoiceId;
    let appended: Awaited<ReturnType<typeof c.var.services.invoice.markPaid>>;
    try {
        appended = await c.var.services.invoice.markPaid(invoiceId, tenantId, 'oi', 'card');
        if (settled.inspectionId) {
            await c.var.services.inspection.markPaymentReceived(tenantId, settled.inspectionId);
        }
    } catch (e) {
        if (e instanceof AppError && e.status === 404) {
            // Invoice purged/gone — retrying can never succeed; ack and move on.
            logger.warn('Stripe webhook: invoice not found — acked', { invoiceId: invoiceId.slice(0, 8) });
            return c.json({ success: true });
        }
        logger.error('Stripe webhook processing error', {}, e instanceof Error ? e : undefined);
        return c.json({ success: false, error: { message: 'Processing failed' } }, 500);
    }

    // QuickBooks learns about card payments here or not at all. `recordPayment`
    // had exactly one caller — the manual "mark as paid" route — so a tenant
    // reconciling their books found every online payment missing.
    //
    // In waitUntil, and deliberately after the ACK path is settled: the customer
    // has already paid, and a QuickBooks outage must not turn a successful
    // payment into a 500 that Stripe redelivers forever.
    //
    // The amount and the key both come from the ledger row `markPaid` appended,
    // never from the invoice: the card settled the REMAINDER, which is the whole
    // total only when no deposit was taken. A redelivery appends nothing and
    // therefore pushes nothing — the requestid stays as the second line of
    // defence rather than the only one.
    if (c.env.QBO_CLIENT_ID && appended) {
        const push = appended;
        c.executionCtx.waitUntil((async () => {
            try {
                await c.var.services.qbo.recordPayment(
                    tenantId, invoiceId, push.amountCents / 100, qboPaymentKey(push.id),
                    push.occurredAt,
                );
            } catch (e) {
                logger.error('Stripe webhook: QBO payment push failed',
                    { invoiceId: invoiceId.slice(0, 8) }, e instanceof Error ? e : undefined);
            }
        })());
    }

    await appendWebhookLogEntry(c.env.TENANT_CACHE, tenantId, {
        eventType: event.type, result: 'processed',
    });
    logger.info('Stripe webhook: invoice settled', {
        invoiceId: invoiceId.slice(0, 8),
        inspectionId: settled.inspectionId?.slice(0, 8),
    });
    return c.json({ success: true });
});

export default api;
