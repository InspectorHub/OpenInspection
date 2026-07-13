import { Hono } from 'hono';
import { z } from 'zod';
import { drizzle } from 'drizzle-orm/d1';
import { eq, isNotNull, and, inArray, isNull, or, gt } from 'drizzle-orm';
import { HonoConfig } from '../types/hono';
import { TenantUpdateParams } from '../lib/integration';
import { TenantStatusBodySchema, SeedStarterContentBodySchema } from '../lib/validations/admin.schema';
import { SyncQuotaSchema } from '../lib/validations/sync-quota.schema';
import { logger } from '../lib/logger';
import { tenantConfigs, inspectionAccessTokens, tenants } from '../lib/db/schema';
import { reencryptAllTenantSecrets } from '../lib/secrets-reencrypt';
import { secretsCacheKey } from '../lib/secrets-cache';
import { OutboxService } from './outbox.service';
import { requireServiceBinding } from './service-binding-guard';
import { aggregateUsage } from '../lib/usage/aggregate';
import { usageCounters } from '../lib/db/schema/usage';
import { FREE_TIER_CAPS } from '../features/plan-quota/policy';
import { getSeatUsage } from '../features/seat-quota/usage';

const api = new Hono<HonoConfig>();

/** Body for POST /sync-redrive. Empty/omitted `ids` re-drives every failed row. */
const SyncRedriveSchema = z.object({
    ids: z.array(z.string()).optional(),
});

/**
 * PATCH /api/integration/tenants/:slug
 * Triggered by Portal when tenant information changes.
 *
 * A-21 batch 2 adjudication: this endpoint is KEPT as permanent RPC — it is
 * the target of (a) the sysadmin console force-sync rescue lever (a rescue
 * channel must not depend on the queue it rescues) and (b) the dispatch
 * fallback when CMD_QUEUE is unbound. The cmd-queue consumer shares the same
 * implementation (apply-commands.ts), so behavior cannot diverge.
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

// A-21 batch 3 adjudication (2026-06-06): POST /tenants/:slug/stripe-connect was
// REMOVED — portal never calls it (Stripe Connect is configured tenant-side via
// the inspector-facing GET/PUT/DELETE /api/admin/stripe-connect; checkout is
// disabled on the portal). The dead M2M write path was the only consumer of
// AdminService.updateStripeConnect / IntegrationProvider.handleStripeConnect,
// which were removed with it.

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

/**
 * POST /api/integration/sync-quota
 * Triggered by Portal whenever a tenant's subscription seat count changes.
 * Updates the tenant's max_users column so InviteService.claim sees the new
 * cap on the next request, then invalidates the per-tenant KV cache.
 */
api.post('/sync-quota', requireServiceBinding, async (c) => {
    const parsed = SyncQuotaSchema.safeParse(await c.req.json());
    if (!parsed.success) {
        return c.json({ success: false, error: { message: 'Invalid input' } }, 400);
    }
    const { tenantId, maxUsers } = parsed.data;
    const { applySyncQuota } = await import('./apply-commands');
    const result = await applySyncQuota(c.env.DB, c.env.TENANT_CACHE, { tenantId, maxUsers });
    if (result === 'tenant-not-found') {
        return c.json({ success: false, error: { message: 'Tenant not found' } }, 404);
    }
    return c.json({ success: true });
});

/**
 * GET /api/integration/tenants/:slug/seat-usage
 * Reverse seat-sync read: lets the portal reconcile a tenant's Stripe seat
 * quantity against the ACTUAL count of active (non-soft-deleted) members,
 * rather than trusting portal's own last-written value. Thin wrapper around
 * getSeatUsage (server/features/seat-quota/usage.ts) — same active-member
 * definition (`deleted_at IS NULL`) used by the invite/seat-guard middleware.
 */
api.get('/tenants/:slug/seat-usage', requireServiceBinding, async (c) => {
    const slug = c.req.param('slug');
    const d = drizzle(c.env.DB);
    const t = await d.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug as string)).get();
    if (!t) return c.json({ success: false, error: { message: 'Tenant not found' } }, 404);

    const usage = await getSeatUsage(t.id as string, c.env.DB);
    return c.json({ success: true, data: { used: usage.used, max: usage.max } });
});

/**
 * POST /api/integration/seed-starter-content
 * Invoked by the portal's OnboardingWorkflow once a tenant is provisioned.
 * Seeds initial templates, agreements, rating-systems, and marketplace
 * defaults. Idempotent — safe to retry.
 *
 * A-21 batch 2 adjudication: KEPT as the CMD_QUEUE-unbound fallback target
 * (the workflow publishes `cmd.tenant.seed_starter_content` when the queue is
 * bound). Same implementation as the cmd consumer (apply-commands.ts).
 */
api.post('/seed-starter-content', requireServiceBinding, async (c) => {
    const parsed = SeedStarterContentBodySchema.safeParse(await c.req.json());
    if (!parsed.success) {
        return c.json({ success: false, error: { message: 'Invalid input' } }, 400);
    }
    const { tenantId } = parsed.data;

    const { applySeedStarterContent } = await import('./apply-commands');
    const result = await applySeedStarterContent(c.env.DB, { tenantId });
    if (result === 'tenant-not-found') {
        return c.json({ success: false, error: { message: 'Tenant not found' } }, 404);
    }
    return c.json({ success: true, data: result.seeded });
});

/**
 * POST /api/integration/backfill-default-templates
 * M2M one-shot endpoint that seeds the default 7 templates for every tenant.
 * Idempotent — TemplateSeedService.bulkSeed skips templates that already
 * exist by name per tenant.
 */
api.post('/backfill-default-templates', requireServiceBinding, async (c) => {
    const { drizzle } = await import('drizzle-orm/d1');
    const { tenants } = await import('../lib/db/schema');
    const { TemplateSeedService } = await import('../services/template-seed.service');
    const db = drizzle(c.env.DB);
    const allTenants = await db.select({ id: tenants.id, name: tenants.name }).from(tenants).all();
    const svc = new TemplateSeedService(c.env.DB);

    const results: { tenantId: string; name: string; seeded: number; skipped: number }[] = [];
    for (const t of allTenants) {
        try {
            const r = await svc.bulkSeed(t.id as string);
            results.push({ tenantId: t.id as string, name: (t.name as string) ?? '', ...r });
        } catch (err) {
            logger.error('Backfill failed for tenant', { tenantId: t.id }, err instanceof Error ? err : undefined);
        }
    }
    const totalSeeded = results.reduce((sum, r) => sum + r.seeded, 0);
    const totalSkipped = results.reduce((sum, r) => sum + r.skipped, 0);
    logger.info('Backfill complete', { tenantCount: results.length, totalSeeded, totalSkipped });
    return c.json({ success: true });
});

/**
 * GET /api/integration/sync-health
 * Operability snapshot of the core->portal sync outbox for the sysadmin
 * console badge: pending + failed counts and the age (seconds) of the oldest
 * pending row. Same requireServiceBinding guard as the sibling M2M routes.
 */
api.get('/sync-health', requireServiceBinding, async (c) => {
    try {
        const counts = await new OutboxService(c.env.DB).counts();
        return c.json({ success: true, data: counts });
    } catch (error: unknown) {
        logger.error('sync-health failed', {}, error instanceof Error ? error : undefined);
        return c.json({ success: false, error: { message: 'Internal server error' } }, 500);
    }
});

/**
 * POST /api/integration/sync-redrive
 * Reset failed outbox rows back to `pending` so the next sweeper tick
 * republishes them. Body: { ids?: string[] } — omit `ids` to re-drive every
 * failed row. Returns the number of rows reset.
 */
api.post('/sync-redrive', requireServiceBinding, async (c) => {
    const parsed = SyncRedriveSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
        return c.json({ success: false, error: { message: 'Invalid input' } }, 400);
    }
    try {
        const redriven = await new OutboxService(c.env.DB).redrive(parsed.data.ids);
        logger.info('sync-redrive applied', { redriven, scoped: !!parsed.data.ids });
        return c.json({ success: true, data: { redriven } });
    } catch (error: unknown) {
        logger.error('sync-redrive failed', {}, error instanceof Error ? error : undefined);
        return c.json({ success: false, error: { message: 'Internal server error' } }, 500);
    }
});

/**
 * POST /api/integration/secrets/reencrypt — JWT_SECRET rotation tool.
 * SaaS-only by construction (this seam is unmounted in standalone); a
 * standalone tenant converges lazily on its next secrets write instead.
 * Idempotent; SOP: docs/saas-ops/jwt-secret-rotation-sop.md.
 */
api.post('/secrets/reencrypt', requireServiceBinding, async (c) => {
    try {
    const db = drizzle(c.env.DB);
    const report = await reencryptAllTenantSecrets({
        listRows: async () => {
            const rows = await db
                .select({ tenantId: tenantConfigs.tenantId, blob: tenantConfigs.secretsEnc, dekEnc: tenantConfigs.dekEnc })
                .from(tenantConfigs)
                .where(isNotNull(tenantConfigs.secretsEnc))
                .all();
            return rows.map(r => ({ tenantId: r.tenantId, blob: r.blob as string, dekEnc: r.dekEnc ?? null }));
        },
        updateRow: async (tenantId, patch) => {
            await db.update(tenantConfigs)
                .set({
                    ...(patch.blob !== undefined ? { secretsEnc: patch.blob } : {}),
                    ...(patch.dekEnc !== undefined ? { dekEnc: patch.dekEnc } : {}),
                    updatedAt: new Date(),
                })
                .where(eq(tenantConfigs.tenantId, tenantId));
        },
        bustCache: async (tenantId) => {
            await c.env.TENANT_CACHE?.delete(secretsCacheKey(tenantId)).catch(() => {});
        },
    }, c.env.JWT_SECRET, c.env.JWT_SECRET_PREVIOUS);
    logger.info('secrets reencrypt completed', {
        migrated: report.migrated, rewrapped: report.rewrapped,
        alreadyCurrent: report.alreadyCurrent, failed: report.failed.length,
    });
    return c.json({ success: true, data: report });
    } catch (error: unknown) {
        logger.error('secrets reencrypt failed', {}, error instanceof Error ? error : undefined);
        return c.json({ success: false, error: { message: 'Internal server error' } }, 500);
    }
});

/**
 * GET /api/integration/usage
 * Platform monitoring: aggregated usage counters across all tenants, for the
 * portal console's usage dashboard. Per tenant: lifetime sums for every
 * metered dimension (platform + bring-your-own sms/email, inspections),
 * the r2_bytes gauge, the tenant's plan tier, and — for a free tenant only —
 * the free-tier caps those platform metrics are measured against (`null`
 * for pro/enterprise, since the cap never applies to them).
 * M2M-guarded by the router mount (requireServiceBinding inherited).
 */
api.get('/usage', requireServiceBinding, async (c) => {
    try {
        const db = drizzle(c.env.DB);
        const rows = await db.select().from(usageCounters).all();
        const usage = aggregateUsage(rows);

        const tenantIds = usage.map((u) => u.tenantId);
        const tierRows = tenantIds.length
            ? await db.select({ id: tenants.id, tier: tenants.tier }).from(tenants).where(inArray(tenants.id, tenantIds)).all()
            : [];
        const tierByTenant = new Map(tierRows.map((t) => [t.id as string, t.tier as string]));

        const data = usage.map((u) => {
            const tier = tierByTenant.get(u.tenantId) ?? 'free';
            return {
                tenantId:    u.tenantId,
                tier,
                inspections: u.inspections,
                sms:         u.sms,
                smsByo:      u.smsByo,
                email:       u.email,
                emailByo:    u.emailByo,
                r2Bytes:     u.r2Bytes,
                caps:        tier === 'free' ? FREE_TIER_CAPS : null,
            };
        });

        return c.json({ success: true, data });
    } catch (error: unknown) {
        logger.error('usage aggregation failed', {}, error instanceof Error ? error : undefined);
        return c.json({ success: false, error: { message: 'Internal server error' } }, 500);
    }
});

/**
 * GET /api/integration/tenants/by-email?email=<email>
 * Cross-tenant client grant lookup: returns the slugs of tenants where the
 * email holds a LIVE (not revoked, not expired) client/co_client access grant.
 * Platform-level read (raw drizzle, no tenant scope) — guarded by
 * requireServiceBinding. Enables a portal-side "find my report" fan-out that
 * triggers each tenant's own magic-link without a cross-tenant session layer.
 */
api.get('/tenants/by-email', requireServiceBinding, async (c) => {
    const email = c.req.query('email');
    if (!email || !email.includes('@')) {
        return c.json({ success: false, error: { message: 'email required' } }, 400);
    }
    try {
        const d = drizzle(c.env.DB);
        const now = new Date();

        const grants = await d
            .select({ tenantId: inspectionAccessTokens.tenantId })
            .from(inspectionAccessTokens)
            .where(and(
                eq(inspectionAccessTokens.recipientEmail, email),
                inArray(inspectionAccessTokens.role, ['client', 'co_client']),
                isNull(inspectionAccessTokens.revokedAt),
                or(isNull(inspectionAccessTokens.expiresAt), gt(inspectionAccessTokens.expiresAt, now)),
            ));

        const tenantIds = [...new Set(grants.map((g) => g.tenantId as string))];
        if (tenantIds.length === 0) return c.json({ success: true, data: { slugs: [] } });

        const rows = await d
            .select({ slug: tenants.slug })
            .from(tenants)
            .where(inArray(tenants.id, tenantIds));

        return c.json({ success: true, data: { slugs: rows.map((r) => r.slug as string) } });
    } catch (error: unknown) {
        logger.error('tenants by-email lookup failed', {}, error instanceof Error ? error : undefined);
        return c.json({ success: false, error: { message: 'Internal server error' } }, 500);
    }
});

export default api;
