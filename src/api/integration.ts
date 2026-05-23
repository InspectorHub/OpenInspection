import { Hono } from 'hono';
import { Context } from 'hono';
import { HonoConfig } from '../types/hono';
import { TenantUpdateParams } from '../lib/integration';
import { TenantStatusBodySchema, StripeConnectBodySchema } from '../lib/validations/admin.schema';
import { logger } from '../lib/logger';
import { verifyM2mSignature } from '../lib/m2m-auth';

const api = new Hono<HonoConfig>();

/**
 * Middleware to verify M2M signature from Portal.
 *
 * Delegates to `verifyM2mSignature` which iterates every active
 * PORTAL_M2M_SECRET_V<N> + legacy PORTAL_M2M_SECRET, enabling
 * zero-downtime overlap-window secret rotation. The legacy single-secret
 * check was removed in favour of the keyring helper.
 */
async function verifyPortalSignature(c: Context<HonoConfig>, next: () => Promise<void>) {
    const env = c.env as unknown as Record<string, string | undefined>;
    const hasAnySecret = !!env['PORTAL_M2M_SECRET']
        || Object.keys(env).some(k => /^PORTAL_M2M_SECRET_V\d+$/.test(k) && env[k]);
    if (!hasAnySecret) {
        logger.error('No PORTAL_M2M_SECRET[_V<N>] configured');
        return c.json({ error: 'Integration not configured' }, 501);
    }

    const signature = c.req.header('x-portal-signature');
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

    const isValid = await verifyM2mSignature(signature, body, env);
    if (!isValid) {
        return c.json({ error: 'Invalid signature' }, 401);
    }

    return next();
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

/**
 * POST /api/integration/tenants/:subdomain/data-export
 * Triggered by Portal during offboarding workflow. Returns ZIP stream.
 */
api.post('/tenants/:subdomain/data-export', verifyPortalSignature, async (c) => {
    const subdomain = c.req.param('subdomain');
    const { drizzle } = await import('drizzle-orm/d1');
    const { eq } = await import('drizzle-orm');
    const { tenants } = await import('../lib/db/schema');
    const d = drizzle(c.env.DB);
    const t = await d.select({ id: tenants.id }).from(tenants).where(eq(tenants.subdomain, subdomain as string)).get();
    if (!t) return c.json({ error: 'Tenant not found' }, 404);

    const { DataExportService } = await import('../services/data-export.service');
    const svc = new DataExportService(c.env.DB, c.env.PHOTOS);
    try {
        const { buffer, manifest } = await svc.buildZip(t.id as string);
        // Wrap Uint8Array in Blob (BodyInit-compatible across Node + Workers)
        const blob = new Blob([buffer as BlobPart], { type: 'application/zip' });
        return new Response(blob, {
            headers: {
                'content-type':        'application/zip',
                'content-disposition': `attachment; filename="export-${subdomain}.zip"`,
                'x-export-manifest':   JSON.stringify(manifest),
            },
        });
    } catch (error: unknown) {
        logger.error('Data export failed', { subdomain }, error instanceof Error ? error : undefined);
        return c.json({ error: 'Export failed' }, 500);
    }
});

/**
 * POST /api/integration/tenants/:subdomain/purge
 * Triggered by Portal at end of offboarding grace period. Cascade-deletes all tenant data.
 */
api.post('/tenants/:subdomain/purge', verifyPortalSignature, async (c) => {
    const subdomain = c.req.param('subdomain');
    const { drizzle } = await import('drizzle-orm/d1');
    const { eq } = await import('drizzle-orm');
    const { tenants } = await import('../lib/db/schema');
    const d = drizzle(c.env.DB);
    const t = await d.select({ id: tenants.id }).from(tenants).where(eq(tenants.subdomain, subdomain as string)).get();
    if (!t) return c.json({ error: 'Tenant not found' }, 404);

    const { TenantPurgeService } = await import('../services/tenant-purge.service');
    const svc = new TenantPurgeService(c.env.DB, c.env.PHOTOS, c.env.TENANT_CACHE);
    try {
        const result = await svc.purge(t.id as string);
        return c.json({ success: true, data: result });
    } catch (error: unknown) {
        logger.error('Tenant purge failed', { subdomain }, error instanceof Error ? error : undefined);
        return c.json({ error: 'Purge failed' }, 500);
    }
});

/**
 * POST /api/integration/sso-handoff
 *
 * Issues a one-time SSO code that the portal hands to the browser
 * so the user lands at `GET /sso?code=...` and gets a workspace-
 * scoped session cookie. Body: { tenantId, email, ttlSeconds? }.
 * Returns: { code } — caller redirects the browser to
 * `https://app.{domain}/sso?code=<code>`.
 *
 * The code is stored in TENANT_CACHE under `sso:<code>` for ttl
 * seconds; consume-side deletes the key on success (single-use).
 * No JWT material in the body — only the lookup tuple — so an
 * exposed code can't be replayed indefinitely.
 */
api.post('/sso-handoff', verifyPortalSignature, async (c) => {
    const body = await c.req.json().catch(() => ({})) as {
        tenantId?: string;
        email?: string;
        ttlSeconds?: number;
    };
    if (!body.tenantId || !body.email) {
        return c.json({ error: 'tenantId and email required' }, 400);
    }
    const ttl = Math.min(Math.max(body.ttlSeconds ?? 60, 5), 300);

    const { drizzle } = await import('drizzle-orm/d1');
    const { eq, and } = await import('drizzle-orm');
    const { users } = await import('../lib/db/schema');
    const d = drizzle(c.env.DB);
    const user = await d.select({ id: users.id })
        .from(users)
        .where(and(eq(users.tenantId, body.tenantId), eq(users.email, body.email)))
        .get();
    if (!user) return c.json({ error: 'No user for that tenant + email' }, 404);

    if (!c.env.TENANT_CACHE) {
        return c.json({ error: 'KV unavailable' }, 503);
    }
    const code = crypto.randomUUID();
    await c.env.TENANT_CACHE.put(
        `sso:${code}`,
        JSON.stringify({ userId: user.id, tenantId: body.tenantId }),
        { expirationTtl: ttl },
    );
    return c.json({ success: true, code, expiresIn: ttl });
});

export default api;
