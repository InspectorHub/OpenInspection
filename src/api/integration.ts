import { Hono } from 'hono';
import { Context } from 'hono';
import { HonoConfig } from '../types/hono';

const api = new Hono<HonoConfig>();

/**
 * Integration API endpoints for Portal M2M communication.
 * In the open-source standalone version, these endpoints return 501 Not Implemented
 * as they require the SaaS Portal integration to be configured.
 */

/**
 * PATCH /api/integration/tenants/:subdomain
 * Triggered by Portal when tenant information changes.
 */
api.patch('/tenants/:subdomain', async (c: Context<HonoConfig>) => {
    const secret = c.env.PORTAL_M2M_SECRET;
    if (!secret) {
        return c.json({ error: 'Integration not configured' }, 501);
    }
    return c.json({ error: 'Not implemented in standalone mode' }, 501);
});

/**
 * POST /api/integration/tenants/:subdomain/stripe-connect
 * Triggered by Portal when Stripe Connect is completed.
 */
api.post('/tenants/:subdomain/stripe-connect', async (c: Context<HonoConfig>) => {
    const secret = c.env.PORTAL_M2M_SECRET;
    if (!secret) {
        return c.json({ error: 'Integration not configured' }, 501);
    }
    return c.json({ error: 'Not implemented in standalone mode' }, 501);
});

export default api;
