import type { MiddlewareHandler } from 'hono';
import type { BrandingConfig } from '../../types/auth';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { tenantConfigs } from '../db/schema';
import type { HonoConfig } from '../../types/hono';
import { logger } from '../logger';
import { memoOnce } from '../request-scope';

/**
 * Middleware to resolve and inject branding configuration for the current tenant.
 * Uses KV for caching and D1 as a fallback.
 */
export const brandingMiddleware: MiddlewareHandler<HonoConfig> = async (c, next) => {
    const tenantId = c.get('tenantId');

    // Deployment-mode flags ride along with branding so layouts and login
    // handlers can read them without taking a second middleware dependency.
    // `portalBaseUrl` deliberately drops any trailing slash so consumers can
    // freely append paths like `${portalBaseUrl}/company/switch`.
    const profile = c.var.profile;
    const isSaas = profile?.mode === 'saas';
    const portalBaseUrl = c.var.profile.loginRedirectBase;
    const tenantStatus = c.get('tenantStatus') ?? 'active';

    // Default system branding (fallback)
    const defaultBranding: BrandingConfig = {
        companyName: c.env.APP_NAME || 'OpenInspection',
        primaryColor: c.env.PRIMARY_COLOR || '#6366f1',
        logoUrl: null,
        supportEmail: c.env.SENDER_EMAIL || 'support@openinspection.org',
        billingUrl: '/settings',
        isSaas,
        portalBaseUrl,
        tenantStatus,
    };

    if (!tenantId) {
        c.set('branding', defaultBranding);
        return await next();
    }

    const cacheKey = `branding:${tenantId}`;

    // The WHOLE resolve is memoised, KV-hit path included, not just the D1
    // fallback: a page render fans out into 15 in-process API calls that each
    // re-enter this chain, so wrapping only the fallback would still leave 15
    // KV round trips. The KV backfill stays inside, which turns 15 writes into
    // one. Reuse inside a single ~350ms render is strictly fresher than the
    // 3600s TTL this already ships with.
    //
    // Everything this closure reads is constant for the life of one request:
    // tenantId is fixed by the time this middleware runs, and isSaas /
    // portalBaseUrl / tenantStatus come from the deployment profile and the
    // resolved tenant, neither of which changes mid-request.
    const branding = await memoOnce(c.env, `branding:${tenantId}`, async (): Promise<BrandingConfig> => {
        const cached = await c.env.TENANT_CACHE?.get(cacheKey);

        if (cached) {
            try {
                return JSON.parse(cached) as BrandingConfig;
            } catch (e) {
                logger.error('[branding] Cache parse failed', {}, e instanceof Error ? e : undefined);
            }
        }

        const db = drizzle(c.env.DB);
        try {
            const config = await db.select({
                companyName: tenantConfigs.companyName,
                primaryColor: tenantConfigs.primaryColor,
                logoUrl: tenantConfigs.logoUrl,
                supportEmail: tenantConfigs.supportEmail,
                billingUrl: tenantConfigs.billingUrl,
                defaultProfileId: tenantConfigs.defaultProfileId
            })
            .from(tenantConfigs)
            .where(eq(tenantConfigs.tenantId, tenantId))
            .get();

            const resolved: BrandingConfig = config ? {
                companyName: config.companyName || defaultBranding.companyName,
                primaryColor: config.primaryColor || defaultBranding.primaryColor,
                logoUrl: config.logoUrl,
                supportEmail: config.supportEmail || defaultBranding.supportEmail,
                billingUrl: config.billingUrl || defaultBranding.billingUrl,
                defaultProfileId: config.defaultProfileId ?? 'signature',
                // No deployment flags here — they are stamped once, below, on
                // every path. Applying them here as well is what let the
                // cache-hit path go without them.
            } : defaultBranding;

            if (config && c.env.TENANT_CACHE) {
                try {
                    const cacheable: BrandingConfig = {
                        companyName:     resolved.companyName,
                        primaryColor: resolved.primaryColor,
                        logoUrl:      resolved.logoUrl,
                        supportEmail: resolved.supportEmail,
                        billingUrl:   resolved.billingUrl,
                    };
                    if (resolved.defaultProfileId !== undefined) cacheable.defaultProfileId = resolved.defaultProfileId;
                    c.executionCtx.waitUntil(c.env.TENANT_CACHE.put(cacheKey, JSON.stringify(cacheable), { expirationTtl: 3600 }));
                } catch {
                    // executionCtx unavailable in test environments
                }
            }

            return resolved;
        } catch (e) {
            logger.error('[branding] DB lookup failed', {}, e instanceof Error ? e : undefined);
            return defaultBranding;
        }
    });

    // The deployment flags are stamped HERE, on every path, and this is the only
    // place that does it. They depend on the deployment profile (mode + login
    // redirect base) and on the tenant this request resolved — not on per-tenant
    // config — which is why the KV entry deliberately does not carry them, and
    // why whatever a stale entry does carry must lose to the live value.
    //
    // They used to be applied inside the D1 branch instead. The cache-hit branch
    // returned the parsed blob verbatim, so once the entry was warm — it has a
    // 3600s TTL, so that is the steady state, not the edge case — branding
    // reached `session-context.ts` with `isSaas` undefined, and every surface
    // gated on it (the "Switch workspace" entry) went dark. Two copies of one
    // rule, and the one on the hot path was the missing one.
    c.set('branding', { ...branding, isSaas, portalBaseUrl, tenantStatus });

    await next();
};
