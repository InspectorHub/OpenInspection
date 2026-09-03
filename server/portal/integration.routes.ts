import { Hono } from 'hono';
import { z } from 'zod';
import { drizzle } from 'drizzle-orm/d1';
import { eq, isNotNull } from 'drizzle-orm';
import type { HonoConfig } from '../types/hono';
import type { TenantUpdateParams } from '../lib/integration';
import { TenantStatusBodySchema, SeedStarterContentBodySchema } from '../lib/validations/admin.schema';
import { SyncQuotaSchema } from '../lib/validations/sync-quota.schema';
import { SsoHandoffSchema } from '../lib/validations/sso-handoff.schema';
import { logger } from '../lib/logger';
import { tenantConfigs, tenants } from '../lib/db/schema';
import { tenantDisplayName } from '../lib/tenant-display-name';
import { reencryptAllTenantSecrets } from '../lib/secrets-reencrypt';
import { buildTenantEmailService } from '../lib/email/build-email-service';
import { secretsCacheKey } from '../lib/secrets-cache';
import { OutboxService } from './outbox.service';
import { requireServiceBinding } from './service-binding-guard';
import { aiProvisioningHandler } from './ai-provisioning';
import { findGlobalAgentByEmail } from '../services/agent/account';
import { usageReportHandler } from './usage-report';
import { destructionRecordsHandler } from './destruction-records';
import { migrationSourceDownloadHandler } from './migration-source-download';
import { tenantsByEmailHandler } from './tenants-by-email';
import { fileDiscoveryObjectionHandler, withdrawDiscoveryObjectionHandler } from './discovery-objection';
import { getSeatUsage } from '../features/seat-quota/usage';

const api = new Hono<HonoConfig>();

/** Body for POST /sync-redrive. Empty/omitted `ids` re-drives every failed row. */
const SyncRedriveSchema = z.object({
    ids: z.array(z.string()).optional(),
});

/**
 * PATCH /api/platform/tenants/:slug
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
 * POST /api/platform/tenants/:slug/data-export
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
 * POST /api/platform/tenants/:slug/purge
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
    // Platform sender (`undefined` tenant): the tenant's own email config is one
    // of the things being destroyed, and this is our message about our failure.
    const svc = new TenantPurgeService(c.env.DB, c.env.PHOTOS, c.env.TENANT_CACHE, { INSPECTION_DOC: c.env.INSPECTION_DOC, TENANT_PRESENCE: c.env.TENANT_PRESENCE }, await buildTenantEmailService(c.env, undefined));
    try {
        const result = await svc.purge(t.id as string);
        return c.json({ success: true, data: result });
    } catch (error: unknown) {
        logger.error('Tenant purge failed', { slug }, error instanceof Error ? error : undefined);
        return c.json({ success: false, error: { message: 'Purge failed' } }, 500);
    }
});

/**
 * GET /api/platform/destruction-records — the read side of the purge above.
 * Handler + why it is deliberately NOT tenant-scoped: ./destruction-records.ts.
 */
api.get('/destruction-records', requireServiceBinding, destructionRecordsHandler);
// A workspace's uploaded import file, for the operator converting it. Refuses
// unattributed, and writes the audit row BEFORE the bytes — reasoning, and why
// that departs from the house pattern, in ./migration-source-download.ts.
api.get('/migration-runs/:batchId/source', requireServiceBinding, migrationSourceDownloadHandler);
// The objection to the cross-tenant lookup below. Its authorisation rule — a
// grant token proving control of the address — lives with the handlers, because
// the reasoning is the feature.
api.post('/discovery-objections', requireServiceBinding, fileDiscoveryObjectionHandler);
api.delete('/discovery-objections', requireServiceBinding, withdrawDiscoveryObjectionHandler);

/**
 * POST /api/platform/sso-handoff
 *
 * Issues a one-time SSO code that the portal hands to the browser
 * so the user lands at `GET /sso?code=...` and gets a workspace-
 * scoped session cookie. Body: { tenantId?, email, ttlSeconds? }.
 * Returns: { code } — caller redirects the browser to
 * `https://app.{domain}/sso?code=<code>`.
 *
 * The code is stored in TENANT_CACHE under `sso:<code>` for ttl
 * seconds; consume-side deletes the key on success (single-use).
 * No JWT material in the body — only the lookup tuple — so an
 * exposed code can't be replayed indefinitely.
 *
 * `tenantId` is OPTIONAL (Spec 3 Task 5b): when present, this is the
 * long-standing tenant-scoped handoff below (unchanged). When ABSENT, this
 * is an agent handoff — portal's Google-OIDC agent-mode callback hands off
 * just the email; findGlobalAgentByEmail (the single shared "live global
 * agent" predicate — server/services/agent/account.ts) resolves the
 * account and the KV payload carries `{ userId }` only, no tenantId. The
 * `/sso` consumer (server/api/auth.ts) detects the tenant-null payload and
 * mints an agent JWT instead of a tenant JWT.
 */
api.post('/sso-handoff', requireServiceBinding, async (c) => {
    const parsed = SsoHandoffSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
        return c.json({ success: false, error: { message: 'Invalid input' } }, 400);
    }
    const body = parsed.data;
    const ttl = Math.min(Math.max(body.ttlSeconds ?? 60, 5), 300);

    if (!body.tenantId) {
        // Agent handoff (Spec 3 Task 5b) — no tenant-scoped lookup; the caller
        // is not asserting a workspace at all, only an email.
        const agent = await findGlobalAgentByEmail(c.env.DB, body.email);
        if (!agent) return c.json({ success: false, error: { message: 'No global agent for that email' } }, 404);

        if (!c.env.TENANT_CACHE) {
            return c.json({ success: false, error: { message: 'KV unavailable' } }, 503);
        }
        const code = crypto.randomUUID();
        await c.env.TENANT_CACHE.put(
            `sso:${code}`,
            JSON.stringify({ userId: agent.id }),
            { expirationTtl: ttl },
        );
        logger.info('sso_handoff.agent_code_issued', { userId: agent.id });
        return c.json({ success: true, data: { code, expiresIn: ttl } });
    }

    // EXISTING tenant path — unchanged.
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
    // The platform person, when the seam carried one, travels with the code and
    // ends up as a claim on the minted session — so every audit row that session
    // produces says the platform did it. It comes off the VERIFIED header and
    // never off the body: a caller able to name its own support operator in JSON
    // is the forgery this whole path exists to prevent.
    const actor = c.get('platformActor');
    await c.env.TENANT_CACHE.put(
        `sso:${code}`,
        JSON.stringify({ userId: user.id, tenantId: body.tenantId, ...(actor ? { actor } : {}) }),
        { expirationTtl: ttl },
    );
    return c.json({ success: true, data: { code, expiresIn: ttl } });
});

/**
 * POST /api/platform/sync-quota
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
 * GET /api/platform/tenants/:slug/seat-usage
 * Reverse seat-sync read: lets the portal reconcile a tenant's Stripe seat
 * quantity against the ACTUAL count of active (non-soft-deleted) members,
 * rather than trusting portal's own last-written value. Reads getSeatUsage's
 * `members` (`deleted_at IS NULL`), NOT its `used`, which also reserves seats
 * outstanding invitations can still claim — that is a quota, not a bill.
 */
api.get('/tenants/:slug/seat-usage', requireServiceBinding, async (c) => {
    const slug = c.req.param('slug');
    const d = drizzle(c.env.DB);
    const t = await d.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug as string)).get();
    if (!t) return c.json({ success: false, error: { message: 'Tenant not found' } }, 404);

    const usage = await getSeatUsage(t.id as string, c.env.DB);
    return c.json({ success: true, data: { used: usage.members, max: usage.max } });
});

/**
 * POST /api/platform/seed-starter-content
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
 * POST /api/platform/backfill-default-templates
 * M2M one-shot endpoint that seeds the default 7 templates for every tenant.
 * Idempotent — TemplateSeedService.bulkSeed skips templates that already
 * exist by name per tenant.
 */
api.post('/backfill-default-templates', requireServiceBinding, async (c) => {
    const { drizzle } = await import('drizzle-orm/d1');
    const { tenants } = await import('../lib/db/schema');
    const { TemplateSeedService } = await import('../services/template-seed.service');
    // DELIBERATELY carries no `templateCreate` capability (#307). This is
    // provisioning, not a staff action: the route is authenticated by the
    // portal M2M HMAC and runs with NO acting user, so there is no capability
    // set to consult. Bolting one on would make tenant seeding depend on a
    // permission nobody holds yet.
    const db = drizzle(c.env.DB);
    // Operational output for a seeding caller, not a display surface.
    const allTenants = await db.select({ id: tenants.id, name: tenantDisplayName })
        .from(tenants).leftJoin(tenantConfigs, eq(tenantConfigs.tenantId, tenants.id)).all();
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
 * GET /api/platform/sync-health
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
 * POST /api/platform/sync-redrive
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
 * POST /api/platform/secrets/reencrypt — JWT_SECRET rotation tool.
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
 * GET /api/platform/usage
 * Platform usage dashboard read — handler + payload notes in ./usage-report.ts.
 */
api.get('/usage', requireServiceBinding, usageReportHandler);

/**
 * GET /api/platform/ai-provisioning
 * Per-tier tenant counts bucketed by the runtime AI credential resolver
 * (managed / byo / unconfigured) for portal's tier-quota console. Handler +
 * contract notes live in ./ai-provisioning.ts.
 */
api.get('/ai-provisioning', requireServiceBinding, aiProvisioningHandler);

// Cross-tenant client grant lookup behind "find my report". What it discloses,
// and why the discovery objection is consulted first, are in ./tenants-by-email.ts
// — that reasoning is the feature, not a footnote to a route table.
api.get('/tenants/by-email', requireServiceBinding, tenantsByEmailHandler);

export default api;
