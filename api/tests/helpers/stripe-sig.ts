/**
 * Generates a Stripe-Webhook-Signature header compatible with both:
 *  - apps/core manual HMAC-SHA256 verifier (raw fetch, no SDK)
 *  - apps/portal Stripe SDK verifier (constructEvent)
 *
 * Format: t=<unix_seconds>,v1=<hex_hmac>
 * HMAC payload: `${timestamp}.${rawBody}`
 */
import { createHmac } from 'node:crypto';

export function makeStripeSignature(rawBody: string, secret: string, timestamp?: number): string {
    const ts = timestamp ?? Math.floor(Date.now() / 1000);
    const payload = `${ts}.${rawBody}`;
    const sig = createHmac('sha256', secret).update(payload).digest('hex');
    return `t=${ts},v1=${sig}`;
}
