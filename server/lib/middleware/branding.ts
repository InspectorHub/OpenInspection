import { MiddlewareHandler } from 'hono';
import { BrandingConfig } from '../../types/auth';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { tenantConfigs } from '../db/schema';
import { HonoConfig } from '../../types/hono';
import { logger } from '../logger';

/**
 * Middleware to resolve and inject branding configuration for the current tenant.
 * Uses KV for caching and D1 as a fallback.
 */
export const brandingMiddleware: MiddlewareHandler<HonoConfig> = async (c, next) => {
    const tenantId = c.get('tenantId');

    // Deployment-mode flags ride along with branding so layouts and login
    // handlers can read them without taking a second middleware dependency.
    // `portalBaseUrl` deliberately drops any trailing slash so consumers can
    // freely append paths like `${portalBaseUrl}/workspace/switch`.
    const profile = c.var.profile;
    const isSaas = profile?.mode === 'saas';
    const portalBaseUrl = c.env.PORTAL_API_URL ? c.env.PORTAL_API_URL.replace(/\/$/, '') : null;
    const tenantStatus = c.get('tenantStatus') ?? 'active';

    // Default system branding (fallback)
    const defaultBranding: BrandingConfig = {
        siteName: c.env.APP_NAME || 'OpenInspection',
        primaryColor: c.env.PRIMARY_COLOR || '#6366f1',
        logoUrl: null,
        supportEmail: c.env.SENDER_EMAIL || 'support@openinspection.org',
        billingUrl: '/settings',
        gaMeasurementId: c.env.GA_MEASUREMENT_ID || null,
        isSaas,
        portalBaseUrl,
        tenantStatus,
    };

    if (!tenantId) {
        c.set('branding', defaultBranding);
        return await next();
    }

    const cacheKey = `branding:${tenantId}`;
    const cached = await c.env.TENANT_CACHE?.get(cacheKey);

    if (cached) {
        try {
            const parsed = JSON.parse(cached) as BrandingConfig;
            c.set('branding', parsed);
            return await next();
        } catch (e) {
            logger.error('[branding] Cache parse failed', {}, e instanceof Error ? e : undefined);
        }
    }

    const db = drizzle(c.env.DB);
    try {
        const config = await db.select({
            siteName: tenantConfigs.siteName,
            primaryColor: tenantConfigs.primaryColor,
            logoUrl: tenantConfigs.logoUrl,
            supportEmail: tenantConfigs.supportEmail,
            billingUrl: tenantConfigs.billingUrl,
            gaMeasurementId: tenantConfigs.gaMeasurementId,
            reportTheme: tenantConfigs.reportTheme
        })
        .from(tenantConfigs)
        .where(eq(tenantConfigs.tenantId, tenantId))
        .get();

        const branding: BrandingConfig = config ? {
            siteName: config.siteName || defaultBranding.siteName,
            primaryColor: config.primaryColor || defaultBranding.primaryColor,
            logoUrl: config.logoUrl,
            supportEmail: config.supportEmail || defaultBranding.supportEmail,
            billingUrl: config.billingUrl || defaultBranding.billingUrl,
            gaMeasurementId: config.gaMeasurementId || defaultBranding.gaMeasurementId,
            reportTheme: (config.reportTheme || 'modern') as 'modern' | 'classic' | 'minimal',
            // Deployment flags re-applied — these are intentionally NOT cached
            // because they depend on env (APP_MODE/PORTAL_API_URL)
            // rather than on per-tenant config, so a tenant moving between
            // standalone and shared during a deploy should pick up the new
            // value on the next request without waiting for the KV TTL.
            isSaas,
            portalBaseUrl,
            tenantStatus,
        } : defaultBranding;

        c.set('branding', branding);

        if (config && c.env.TENANT_CACHE) {
            try {
                const cacheable: BrandingConfig = {
                    siteName:     branding.siteName,
                    primaryColor: branding.primaryColor,
                    logoUrl:      branding.logoUrl,
                    supportEmail: branding.supportEmail,
                    billingUrl:   branding.billingUrl,
                };
                if (branding.gaMeasurementId !== undefined) cacheable.gaMeasurementId = branding.gaMeasurementId;
                if (branding.reportTheme !== undefined)     cacheable.reportTheme     = branding.reportTheme;
                c.executionCtx.waitUntil(c.env.TENANT_CACHE.put(cacheKey, JSON.stringify(cacheable), { expirationTtl: 3600 }));
            } catch {
                // executionCtx unavailable in test environments
            }
        }
    } catch (e) {
        logger.error('[branding] DB lookup failed', {}, e instanceof Error ? e : undefined);
        c.set('branding', defaultBranding);
    }

    await next();
};
