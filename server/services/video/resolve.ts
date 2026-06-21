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

/**
 * Resolve the appropriate VideoBackend for the current request.
 *
 * Reads `c.env.APP_MODE` to determine deployment mode, then:
 * - SaaS: loads `tenants.tier`/`status` and applies the plan gate.
 * - Self-host: loads `tenant_configs.videoMode` (default 'r2') and
 *   optionally `integrationConfig.streamCustomerSubdomain`.
 *
 * Throws `ServiceUnavailable` (503) when provider='stream' but the
 * required STREAM binding or customer subdomain is absent.
 */
export async function resolveVideoBackend(c: Context<HonoConfig>): Promise<ResolvedVideoBackend> {
    const isSaas = c.env.APP_MODE === 'saas';
    const tenantId = c.get('tenantId');
    const db = drizzle(c.env.DB);
    const baseUrl = getBaseUrl(c);

    let provider: 'r2' | 'stream';
    let streamSubdomain: string | null;

    if (isSaas) {
        // SaaS: plan gate — paid tenants (pro/enterprise, non-trial) get Stream.
        const tenantRow = await db
            .select({ tier: tenants.tier, status: tenants.status })
            .from(tenants)
            .where(eq(tenants.id, tenantId))
            .get();

        const tier = tenantRow?.tier ?? 'free';
        const status = tenantRow?.status ?? 'pending';
        const paid = (tier === 'pro' || tier === 'enterprise') && status !== 'trial';

        if (paid) {
            provider = 'stream';
            streamSubdomain = c.env.STREAM_CUSTOMER_SUBDOMAIN ?? null;
        } else {
            provider = 'r2';
            streamSubdomain = null;
        }

        logger.info('resolveVideoBackend: saas resolution', {
            tenantId,
            tier,
            status,
            paid,
            provider,
        });
    } else {
        // Self-host: per-tenant videoMode (default 'r2').
        const cfgRow = await db
            .select({ videoMode: tenantConfigs.videoMode, integrationConfig: tenantConfigs.integrationConfig })
            .from(tenantConfigs)
            .where(eq(tenantConfigs.tenantId, tenantId))
            .get();

        const videoMode = cfgRow?.videoMode ?? 'r2';

        if (videoMode === 'stream') {
            provider = 'stream';
            const rawCfg = cfgRow?.integrationConfig;
            let parsed: Record<string, unknown> = {};
            if (rawCfg) {
                try {
                    parsed = JSON.parse(rawCfg) as Record<string, unknown>;
                } catch {
                    logger.error('resolveVideoBackend: failed to parse integrationConfig JSON', {
                        tenantId,
                    });
                }
            }
            streamSubdomain = typeof parsed.streamCustomerSubdomain === 'string'
                ? parsed.streamCustomerSubdomain
                : null;
        } else {
            provider = 'r2';
            streamSubdomain = null;
        }

        logger.info('resolveVideoBackend: standalone resolution', {
            tenantId,
            videoMode,
            provider,
        });
    }

    // Fail closed: if Stream was selected but config is incomplete, throw 503.
    if (provider === 'stream') {
        if (!c.env.STREAM || !streamSubdomain) {
            throw Errors.ServiceUnavailable(
                'Stream video is enabled but not configured (missing subdomain or STREAM binding).',
            );
        }

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
