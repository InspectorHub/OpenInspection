import { Hono } from 'hono';
import { Context } from 'hono';
import { HonoConfig } from '../types/hono';

const api = new Hono<HonoConfig>();

/**
 * Integration API endpoints for external system webhooks.
 * These endpoints are disabled by default and require configuration via environment variables.
 */

/**
 * PATCH /api/integration/tenants/:subdomain
 * Webhook for external tenant information updates.
 */
api.patch('/tenants/:subdomain', async (c: Context<HonoConfig>) => {
    const secret = c.env.INTEGRATION_SECRET;
    if (!secret) {
        return c.json({ error: 'Integration endpoint not configured' }, 501);
    }
    return c.json({ error: 'Not implemented in standalone mode' }, 501);
});

/**
 * POST /api/integration/tenants/:subdomain/stripe-connect
 * Webhook for external Stripe Connect completion events.
 */
api.post('/tenants/:subdomain/stripe-connect', async (c: Context<HonoConfig>) => {
    const secret = c.env.INTEGRATION_SECRET;
    if (!secret) {
        return c.json({ error: 'Integration endpoint not configured' }, 501);
    }
    return c.json({ error: 'Not implemented in standalone mode' }, 501);
});

export default api;
