/**
 * resolveVideoBackend — selects the active VideoBackend per request using
 * a 4-way table keyed on deployment mode and tenant state.
 *
 * Resolution table:
 *
 * | Deployment | Tenant state                                    | provider | streamSubdomain               |
 * |------------|-------------------------------------------------|----------|-------------------------------|
 * | SaaS       | free OR status='trial'                          | r2       | —                             |
 * | SaaS       | paid (tier∈{pro,enterprise} AND status≠'trial') | stream   | env STREAM_CUSTOMER_SUBDOMAIN |
 * | Self-host  | tenant_configs.videoMode='r2' (default)         | r2       | —                             |
 * | Self-host  | videoMode='stream'                              | stream   | integrationConfig.streamCustomerSubdomain |
 *
 * Fail closed: if the resolved provider is 'stream' but the required config
 * (subdomain or STREAM binding) is absent, throws ServiceUnavailable rather
 * than silently falling back to r2. The caller gets a clear 503 with an
 * actionable message.
 */

import type { Context } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { tenants, tenantConfigs } from '../../lib/db/schema';
import { Errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { getBaseUrl } from '../../lib/url';
import type { HonoConfig } from '../../types/hono';
import type { VideoBackend } from './types';
import { StreamVideoBackend } from './stream-backend';
import { R2VideoBackend } from './r2-backend';

export interface ResolvedVideoBackend {
    backend: VideoBackend;
    provider: 'r2' | 'stream';
    streamSubdomain: string | null;
}

/** What the tenant's configuration asks for, plus whether it can be served. */
export interface ResolvedVideoProvider {
    provider: 'r2' | 'stream';
    streamSubdomain: string | null;
    streamBindingPresent: boolean;
}

/**
 * Whether a `stream` request can actually be served.
 *
 * Single source for a rule that used to live in two places and disagree:
 * resolveVideoBackend threw 503 on a misconfigured stream tenant while
 * session-context quietly reported 'r2', so the editor rendered the R2 capture
 * path against an API that refused every call (OI #308 Task 4).
 */
export function videoStreamServiceable(r: ResolvedVideoProvider): boolean {
    return r.provider === 'stream' && r.streamBindingPresent && !!r.streamSubdomain;
}

/**
 * Resolve the video provider the tenant's configuration asks for.
 *
 * The deployment decides WHO chooses (`profile.videoBackendManaged`): in saas
 * the platform plan-gates it off tenants.tier/status; in standalone the
 * operator sets tenant_configs.videoMode. Never branch on APP_MODE here.
 */
export async function resolveVideoProvider(
    c: Context<HonoConfig>,
    tenantId: string,
    db: DrizzleD1Database,
): Promise<ResolvedVideoProvider> {
    const streamBindingPresent = !!c.env.STREAM;

    if (c.var.profile.videoBackendManaged) {
        const tenantRow = await db
            .select({ tier: tenants.tier, status: tenants.status })
            .from(tenants)
            .where(eq(tenants.id, tenantId))
            .get();

        const tier = tenantRow?.tier ?? 'free';
        const status = tenantRow?.status ?? 'pending';
        const paid = (tier === 'pro' || tier === 'enterprise') && status !== 'trial';

        logger.info('resolveVideoProvider: managed resolution', { tenantId, tier, status, paid });
        return paid
            ? { provider: 'stream', streamSubdomain: c.env.STREAM_CUSTOMER_SUBDOMAIN ?? null, streamBindingPresent }
            : { provider: 'r2', streamSubdomain: null, streamBindingPresent };
    }

    const cfgRow = await db
        .select({ videoMode: tenantConfigs.videoMode, integrationConfig: tenantConfigs.integrationConfig })
        .from(tenantConfigs)
        .where(eq(tenantConfigs.tenantId, tenantId))
        .get();

    const videoMode = cfgRow?.videoMode ?? 'r2';
    logger.info('resolveVideoProvider: self-host resolution', { tenantId, videoMode });

    if (videoMode !== 'stream') {
        return { provider: 'r2', streamSubdomain: null, streamBindingPresent };
    }

    let parsed: Record<string, unknown> = {};
    const rawCfg = cfgRow?.integrationConfig;
    if (rawCfg) {
        try {
            parsed = JSON.parse(rawCfg) as Record<string, unknown>;
        } catch {
            logger.error('resolveVideoProvider: failed to parse integrationConfig JSON', { tenantId });
        }
    }
    const streamSubdomain = typeof parsed.streamCustomerSubdomain === 'string'
        ? parsed.streamCustomerSubdomain
        : null;

    return { provider: 'stream', streamSubdomain, streamBindingPresent };
}

/**
 * Resolve the appropriate VideoBackend for the current request.
 *
 * Reads `profile.videoBackendManaged` to determine who chooses the backend, then:
 * - SaaS: loads `tenants.tier`/`status` and applies the plan gate.
 * - Self-host: loads `tenant_configs.videoMode` (default 'r2') and
 *   optionally `integrationConfig.streamCustomerSubdomain`.
 *
 * Throws `ServiceUnavailable` (503) when provider='stream' but the
 * required STREAM binding or customer subdomain is absent.
 */
export async function resolveVideoBackend(c: Context<HonoConfig>): Promise<ResolvedVideoBackend> {
    const tenantId = c.get('tenantId');
    const db = drizzle(c.env.DB);
    const baseUrl = getBaseUrl(c);

    const resolved = await resolveVideoProvider(c, tenantId, db);
    const { provider, streamSubdomain } = resolved;

    // Fail closed: stream was asked for but cannot be served.
    if (provider === 'stream' && !videoStreamServiceable(resolved)) {
        throw Errors.ServiceUnavailable(
            'Stream video is enabled but not configured (missing subdomain or STREAM binding).',
        );
    }

    if (provider === 'stream') {
        const backend: VideoBackend = new StreamVideoBackend(
            c.env.STREAM,
            tenantId,
            baseUrl,
            db,
        );
        return { backend, provider, streamSubdomain };
    }

    // R2 backend — always available when PHOTOS and DB are bound.
    const backend: VideoBackend = new R2VideoBackend(
        c.env.PHOTOS,
        db,
        tenantId,
        c.env.JWT_SECRET,
        baseUrl,
    );
    return { backend, provider: 'r2', streamSubdomain: null };
}
