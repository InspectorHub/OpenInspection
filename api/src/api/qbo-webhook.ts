import { Hono } from 'hono';
import type { HonoConfig } from '../types/hono';
import { logger } from '../lib/logger';

const api = new Hono<HonoConfig>();

// Excluded from JWT middleware (see index.ts `isPublic`) — verified via the
// intuit-signature HMAC inside QBOService.handleWebhook.
api.post('/', async (c) => {
    const headerSig = c.req.header('intuit-signature');
    if (!headerSig) {
        logger.info('QBO webhook: missing intuit-signature header');
        return c.json({ error: 'Missing signature' }, 401);
    }

    // Read raw body before any parsing — HMAC must use the exact bytes Intuit signed.
    const rawBody = await c.req.text();
    const svc = c.var.services.qbo;
    const invoiceSvc = c.var.services.invoice;

    // Respond 200 immediately — Intuit retries on non-200, so do the work in the background.
    c.executionCtx.waitUntil(
        svc.handleWebhook(
            rawBody,
            headerSig,
            (invoiceId, tenantId) => invoiceSvc.markPaid(invoiceId, tenantId, 'qbo'),
            (invoiceId, _balance, tenantId) => invoiceSvc.markPartial(invoiceId, tenantId, 'qbo'),
        ).then(({ valid }) => {
            if (!valid) logger.info('QBO webhook: signature mismatch — discarded');
        }).catch(e => {
            logger.error('QBO webhook processing error', {}, e instanceof Error ? e : undefined);
        }),
    );

    return c.json({ ok: true });
});

export default api;
