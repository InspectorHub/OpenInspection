/**
 * Ingress guard for the unauthenticated inbound webhooks (QuickBooks, Stripe).
 *
 * Runs BEFORE tenant routing, the stored-secrets merge and the handlers, so a
 * refused delivery costs no tenant, KV or D1 lookup and no decryption:
 *   1. per-source rate limit (429),
 *   2. request body size cap (413), checked on Content-Length and again while
 *      reading, because the header can be absent or wrong.
 * The bytes read are handed on unchanged (the signature covers them exactly).
 *
 * Both refusals are logged without any secret or body. Stripe retries non-2xx
 * deliveries for up to three days; Intuit's retry behaviour for a non-2xx answer
 * is not verified here, so a refused QuickBooks delivery may be lost for good,
 * which is why the log line exists.
 *
 * Ceilings (the bindings' own limits live in wrangler.jsonc): QuickBooks 120 per
 * minute per source IP -- Intuit batches events into one request and sends from
 * a small pool of addresses, so a legitimate burst is a handful of requests;
 * Stripe 300 per minute per company and source IP -- one company's payment burst
 * (a busy day closing many invoices) fits well inside it. Bodies: QuickBooks
 * 256 KB (a batch of CloudEvents is a few KB); Stripe 1 MB (events are a few KB).
 */
import type { MiddlewareHandler } from 'hono';
import type { HonoConfig } from '../../types/hono';
import { checkRateLimit } from '../rate-limit';
import { logger } from '../logger';

const QBO_MAX_BODY_BYTES = 256 * 1024;
const STRIPE_MAX_BODY_BYTES = 1024 * 1024;

type Route = 'quickbooks' | 'stripe';

function classify(path: string): Route | null {
    if (path === '/webhooks/quickbooks') return 'quickbooks';
    if (path === '/webhooks/stripe' || path.startsWith('/webhooks/stripe/')) return 'stripe';
    return null;
}

/** The body bytes, or null as soon as more than `max` have arrived. */
async function readCapped(req: Request, max: number): Promise<Uint8Array | null> {
    if (!req.body) return new Uint8Array(0);
    const reader = req.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > max) {
            await reader.cancel();
            return null;
        }
        chunks.push(value);
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const chunk of chunks) { out.set(chunk, at); at += chunk.byteLength; }
    return out;
}

export const webhookIngressGuard: MiddlewareHandler<HonoConfig> = async (c, next) => {
    if (c.req.method !== 'POST') return next();
    const route = classify(c.req.path);
    if (!route) return next();

    try {
        if (route === 'quickbooks') {
            await checkRateLimit(c, 'webhook-qbo', undefined, 'QBO_WEBHOOK_RATE_LIMITER');
        } else {
            const slug = c.req.path.split('/')[3] ?? '';
            const ip = c.req.header('CF-Connecting-IP') ?? 'unknown';
            await checkRateLimit(c, 'webhook-stripe', `${slug}:${ip}`, 'STRIPE_WEBHOOK_RATE_LIMITER');
        }
    } catch (err) {
        logger.warn('Webhook delivery rate limited -- refused', { route });
        throw err;
    }

    const max = route === 'quickbooks' ? QBO_MAX_BODY_BYTES : STRIPE_MAX_BODY_BYTES;
    const tooLarge = () => {
        logger.warn('Webhook delivery too large -- refused', { route, maxBytes: max });
        return c.json({ success: false, error: { message: 'Payload too large' } }, 413);
    };

    const declared = Number(c.req.header('content-length'));
    if (Number.isFinite(declared) && declared > max) return tooLarge();

    const bytes = await readCapped(c.req.raw, max);
    if (!bytes) return tooLarge();
    c.req.raw = new Request(c.req.raw.url, { method: 'POST', headers: c.req.raw.headers, body: bytes });
    return next();
};
