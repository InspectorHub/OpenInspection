import { Hono } from 'hono';
import { Context } from 'hono';
import { HonoConfig } from '../types/hono';
import { TenantUpdateParams } from '../lib/integration';
import { TenantStatusBodySchema, StripeConnectBodySchema } from '../lib/validations/admin.schema';
import { logger } from '../lib/logger';

const api = new Hono<HonoConfig>();

/**
 * Middleware to verify M2M signature from Portal.
 */
async function verifyPortalSignature(c: Context<HonoConfig>, next: () => Promise<void>) {
    const signature = c.req.header('x-portal-signature');
    const secret = c.env.PORTAL_M2M_SECRET;

    if (!secret) {
        logger.error('PORTAL_M2M_SECRET is not configured');
        return c.json({ error: 'Integration not configured' }, 501);
    }

    if (!signature) {
        return c.json({ error: 'Missing signature' }, 401);
    }

    const rawBody = await c.req.raw.clone().text();
    let body: string;
    try {
        // Normalize JSON to prevent whitespace issues between environments
        body = JSON.stringify(JSON.parse(rawBody));
    } catch {
        body = rawBody;
    }

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['verify']
    );

    const sigParts = signature.split('.');
    if (sigParts.length !== 2) return c.json({ error: 'Invalid signature format' }, 401);

    const [timestamp, hash] = sigParts;
    const data = `${timestamp}.${body}`;

    // Verify timestamp (within 5 minutes)
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - parseInt(timestamp)) > 300) {
        return c.json({ error: 'Signature expired' }, 401);
    }

    const isValid = await crypto.subtle.verify(
        'HMAC',
        key,
        hexToUint8Array(hash),
        encoder.encode(data)
    );

    if (!isValid) {
        return c.json({ error: 'Invalid signature' }, 401);
    }

    return next();
}

function hexToUint8Array(hex: string) {
    const arr = new Uint8Array(hex.length / 2);
    for (let i = 0; i < arr.length; i++) {
        arr[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
    }
    return arr;
}

/**
 * PATCH /api/integration/tenants/:subdomain
 * Triggered by Portal when tenant information changes.
 */
api.patch('/tenants/:subdomain', verifyPortalSignature, async (c) => {
    const subdomain = c.req.param('subdomain');
    const parsed = TenantStatusBodySchema.safeParse(await c.req.json());
    if (!parsed.success) {
        return c.json({ error: 'Invalid input', details: parsed.error.flatten().fieldErrors }, 400);
    }

    const adminService = c.var.services.admin;

    try {
        await adminService.handleTenantUpdate({
            ...parsed.data,
            subdomain,
        } as TenantUpdateParams);

        return c.json({ success: true });
    } catch (error: unknown) {
        logger.error('Failed to handle tenant update', {}, error instanceof Error ? error : undefined);
        return c.json({ error: 'Internal server error' }, 500);
    }
});

/**
 * POST /api/integration/tenants/:subdomain/stripe-connect
 * Triggered by Portal when Stripe Connect is completed.
 */
api.post('/tenants/:subdomain/stripe-connect', verifyPortalSignature, async (c) => {
    const subdomain = c.req.param('subdomain');
    const parsed = StripeConnectBodySchema.safeParse(await c.req.json());
    if (!parsed.success) {
        return c.json({ error: 'Invalid input', details: parsed.error.flatten().fieldErrors }, 400);
    }

    const adminService = c.var.services.admin;

    try {
        await adminService.updateStripeConnect(subdomain as string, parsed.data.accountId);
        return c.json({ success: true });
    } catch (error: unknown) {
        logger.error('Failed to handle stripe connect', {}, error instanceof Error ? error : undefined);
        return c.json({ error: 'Internal server error' }, 500);
    }
});

export default api;
