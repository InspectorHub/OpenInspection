import { Hono } from 'hono';
import { HonoConfig } from '../types/hono';
import { TenantUpdateParams } from '../lib/integration';
import { TenantStatusBodySchema, StripeConnectBodySchema } from '../lib/validations/admin.schema';
import { logger } from '../lib/logger';
import { requireServiceBinding } from './service-binding-guard';

const api = new Hono<HonoConfig>();

/**
 * PATCH /api/integration/tenants/:slug
 * Triggered by Portal when tenant information changes.
 */
api.patch('/tenants/:slug', requireServiceBinding, async (c) => {
    const slug = c.req.param('slug');
    const parsed = TenantStatusBodySchema.safeParse(await c.req.json());
    if (!parsed.success) {
        return c.json({ success: false, error: { message: 'Invalid input' } }, 400);
    }

    const adminService = c.var.services.admin;

    try {
        await adminService.handleTenantUpdate({
            ...parsed.data,
            slug,
        } as TenantUpdateParams);

        return c.json({ success: true });
    } catch (error: unknown) {
        logger.error('Failed to handle tenant update', {}, error instanceof Error ? error : undefined);
        return c.json({ success: false, error: { message: 'Internal server error' } }, 500);
    }
});

/**
 * POST /api/integration/tenants/:slug/stripe-connect
 * Triggered by Portal when Stripe Connect is completed.
 */
api.post('/tenants/:slug/stripe-connect', requireServiceBinding, async (c) => {
    const slug = c.req.param('slug');
    const parsed = StripeConnectBodySchema.safeParse(await c.req.json());
    if (!parsed.success) {
        return c.json({ success: false, error: { message: 'Invalid input' } }, 400);
    }

    const adminService = c.var.services.admin;

    try {
        await adminService.updateStripeConnect(slug as string, parsed.data.accountId);
        return c.json({ success: true });
    } catch (error: unknown) {
        logger.error('Failed to handle stripe connect', {}, error instanceof Error ? error : undefined);
        return c.json({ success: false, error: { message: 'Internal server error' } }, 500);
    }
});

/**
 * POST /api/integration/tenants/:slug/data-export
 * Triggered by Portal during offboarding workflow. Returns ZIP stream.
 */
api.post('/tenants/:slug/data-export', requireServiceBinding, async (c) => {
    const slug = c.req.param('slug');
    const { drizzle } = await import('drizzle-orm/d1');
    const { eq } = await import('drizzle-orm');
    const { tenants } = await import('../lib/db/schema');
    const d = drizzle(c.env.DB);
    const t = await d.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug as string)).get();
    if (!t) return c.json({ success: false, error: { message: 'Tenant not found' } }, 404);

    const { DataExportService } = await import('../services/data-export.service');
    const svc = new DataExportService(c.env.DB, c.env.PHOTOS);
    try {
        const { buffer, manifest } = await svc.buildZip(t.id as string);
        // Wrap Uint8Array in Blob (BodyInit-compatible across Node + Workers)
        const blob = new Blob([buffer as unknown as ArrayBuffer], { type: 'application/zip' });
        return new Response(blob, {
            headers: {
                'content-type':        'application/zip',
                'content-disposition': `attachment; filename="export-${slug}.zip"`,
                'x-export-manifest':   JSON.stringify(manifest),
            },
        });
    } catch (error: unknown) {
        logger.error('Data export failed', { slug }, error instanceof Error ? error : undefined);
        return c.json({ success: false, error: { message: 'Export failed' } }, 500);
    }
});

/**
 * POST /api/integration/tenants/:slug/purge
 * Triggered by Portal at end of offboarding grace period. Cascade-deletes all tenant data.
 */
api.post('/tenants/:slug/purge', requireServiceBinding, async (c) => {
    const slug = c.req.param('slug');
    const { drizzle } = await import('drizzle-orm/d1');
    const { eq } = await import('drizzle-orm');
    const { tenants } = await import('../lib/db/schema');
    const d = drizzle(c.env.DB);
    const t = await d.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug as string)).get();
    if (!t) return c.json({ success: false, error: { message: 'Tenant not found' } }, 404);

    const { TenantPurgeService } = await import('../services/tenant-purge.service');
    const svc = new TenantPurgeService(c.env.DB, c.env.PHOTOS, c.env.TENANT_CACHE);
    try {
        const result = await svc.purge(t.id as string);
        return c.json({ success: true, data: result });
    } catch (error: unknown) {
        logger.error('Tenant purge failed', { slug }, error instanceof Error ? error : undefined);
        return c.json({ success: false, error: { message: 'Purge failed' } }, 500);
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
api.post('/sso-handoff', requireServiceBinding, async (c) => {
    const body = await c.req.json().catch(() => ({})) as {
        tenantId?: string;
        email?: string;
        ttlSeconds?: number;
    };
    if (!body.tenantId || !body.email) {
        return c.json({ success: false, error: { message: 'tenantId and email required' } }, 400);
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
    if (!user) return c.json({ success: false, error: { message: 'No user for that tenant + email' } }, 404);

    if (!c.env.TENANT_CACHE) {
        return c.json({ success: false, error: { message: 'KV unavailable' } }, 503);
    }
    const code = crypto.randomUUID();
    await c.env.TENANT_CACHE.put(
        `sso:${code}`,
        JSON.stringify({ userId: user.id, tenantId: body.tenantId }),
        { expirationTtl: ttl },
    );
    return c.json({ success: true, data: { code, expiresIn: ttl } });
});

export default api;
