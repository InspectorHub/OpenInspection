import { Hono } from 'hono';
import type { HonoConfig } from '../types/hono';
import { logger } from '../lib/logger';
import { webhookCandidates } from '../services/qbo/webhook-secret';

const api = new Hono<HonoConfig>();

// Excluded from JWT middleware (see index.ts `isPublic`) — verified via the
// intuit-signature HMAC inside QBOService.handleWebhook.
api.post('/', async (c) => {
    const headerSig = c.req.header('intuit-signature');
    if (!headerSig) {
        logger.info('QBO webhook: missing intuit-signature header');
        return c.json({ success: false, error: { message: 'Missing signature' } }, 401);
    }

    // Read raw body before any parsing — HMAC must use the exact bytes Intuit signed.
    const rawBody = await c.req.text();
    const invoiceSvc = c.var.services.invoice;

    // Verifier token, in order: Worker env, then the stored secrets of the
    // company the route established (the fixed standalone company -- both merged
    // into c.env by integrationSecretsMiddleware), then the stored secrets of the
    // company that holds the realm the body names. That last step only chooses
    // which stored token to TRY; the signature must still verify against it, and
    // the events are then confined to that company.
    let svc = c.var.services.qbo;
    let onlyTenantId: string | undefined;
    if (!svc.webhookSecret) {
        let verified = 0;
        for (const candidate of await webhookCandidates(c.env, rawBody)) {
            if (await candidate.service.verifyWebhookSignature(rawBody, headerSig)) {
                verified++;
                if (!onlyTenantId) {
                    svc = candidate.service;
                    onlyTenantId = candidate.tenantId;
                }
            }
        }
        // Two companies sharing one verifier token: the first wins and the rest
        // are not served, and Intuit will not retry a 200 -- so say so.
        if (verified > 1) {
            logger.warn('QBO webhook: more than one company token verified the delivery', { verified });
        }
    }

    // Respond 200 immediately — Intuit retries on non-200, so do the work in the background.
    c.executionCtx.waitUntil(
        svc.handleWebhook(
            rawBody,
            headerSig,
            // The appended row is deliberately dropped on the INBOUND path:
            // QuickBooks told us about this money, so pushing it back to them
            // would book it a second time.
            async (invoiceId, tenantId) => { await invoiceSvc.markPaid(invoiceId, tenantId, 'qbo'); },
            async (invoiceId, amountPaidCents, tenantId) => { await invoiceSvc.markPartial(invoiceId, tenantId, 'qbo', amountPaidCents); },
            onlyTenantId,
        ).then(({ valid }) => {
            if (!valid) logger.info('QBO webhook: signature mismatch — discarded');
        }).catch(e => {
            logger.error('QBO webhook processing error', {}, e instanceof Error ? e : undefined);
        }),
    );

    return c.json({ success: true });
});

export default api;
