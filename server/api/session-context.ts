import {} from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { drizzle } from 'drizzle-orm/d1';
import { and, eq } from 'drizzle-orm';
import { users, tenantConfigs, tenants } from '../lib/db/schema';
import { getSeatUsage } from '../features/seat-quota';
import { Errors } from '../lib/errors';
import { logger } from '../lib/logger';
import { mcpEnabled } from '../lib/mcp/flag';

/**
 * Session context endpoint for the React Router v7 frontend layout.
 *
 * Returns branding, user info, and deployment context so the
 * client-side layout can conditionally render features like:
 * - Custom branding (site name, logo, colors)
 * - Suspension banners
 * - GA tracking
 * - Seat quota banners
 * - "Switch workspace" links
 * - Booking slug in command palette
 *
 * Mounted at `/api/session/context` — requires JWT auth.
 */
export const sessionContextRoutes = createApiRouter()
    .get('/context', async (c) => {
        const user = c.get('user');
        if (!user?.sub) {
            throw Errors.Unauthorized('Authentication required');
        }

        const branding = c.get('branding');
        const profile = c.var.profile;
        const tenantId = c.get('tenantId');

        // Look up the user's name, email, and timezone override from DB, plus the
        // tenant's default timezone (both drive the client display-timezone hook).
        let userName: string | null = null;
        let userEmail: string | null = null;
        let userTimezone: string | null = null;
        let tenantTimezone = 'UTC';
        if (tenantId) {
            try {
                const db = drizzle(c.env.DB);
                const row = await db.select({ name: users.name, email: users.email, timezone: users.timezone })
                    .from(users)
                    .where(and(eq(users.id, user.sub), eq(users.tenantId, tenantId)))
                    .get();
                if (row) {
                    userName = row.name;
                    userEmail = row.email;
                    userTimezone = row.timezone;
                }
                const cfg = await db.select({ defaultTimezone: tenantConfigs.defaultTimezone })
                    .from(tenantConfigs)
                    .where(eq(tenantConfigs.tenantId, tenantId))
                    .get();
                if (cfg?.defaultTimezone) tenantTimezone = cfg.defaultTimezone;
            } catch (e) {
                logger.warn('[session-context] user lookup failed', { userId: user.sub, error: (e as Error).message });
            }
        }

        // Compute initials from the user's name
        const initials = userName
            ? userName.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
            : 'OI';

        // Seat usage (only for profiles that enforce seat quotas)
        let seatUsage: { used: number; limit: number } | null = null;
        if (profile.hasSeatQuota && tenantId) {
            try {
                const usage = await getSeatUsage(tenantId, c.env.DB);
                if (usage.max !== null) {
                    seatUsage = { used: usage.used, limit: usage.max };
                }
            } catch (e) {
                logger.warn('[session-context] seat usage lookup failed', { error: (e as Error).message });
            }
        }

        // Resolve the video backend provider for this tenant. Used by the
        // inspection editor to render the correct VideoCapture/VideoPlayer branch.
        let videoProvider: 'r2' | 'stream' = 'r2';
        if (tenantId) {
            try {
                const db = drizzle(c.env.DB);
                const isSaas = c.env.APP_MODE === 'saas';
                if (isSaas) {
                    const tenantRow = await db
                        .select({ tier: tenants.tier, status: tenants.status })
                        .from(tenants)
                        .where(eq(tenants.id, tenantId))
                        .get();
                    const tier = tenantRow?.tier ?? 'free';
                    const status = tenantRow?.status ?? 'pending';
                    const paid = (tier === 'pro' || tier === 'enterprise') && status !== 'trial';
                    videoProvider = paid ? 'stream' : 'r2';
                } else {
                    const cfgRow = await db
                        .select({ videoMode: tenantConfigs.videoMode, integrationConfig: tenantConfigs.integrationConfig })
                        .from(tenantConfigs)
                        .where(eq(tenantConfigs.tenantId, tenantId))
                        .get();
                    const videoModeRaw = (cfgRow?.videoMode as 'r2' | 'stream' | null) ?? null;
                    if (videoModeRaw === 'stream' && !!c.env.STREAM) {
                        // Mirror resolveVideoBackend: also require a non-empty
                        // streamCustomerSubdomain, otherwise create-upload throws 503.
                        let streamSubdomain = '';
                        const rawCfg = (cfgRow as unknown as { integrationConfig?: string | null } | null)?.integrationConfig ?? null;
                        if (rawCfg) {
                            try {
                                const parsed = JSON.parse(rawCfg) as Record<string, unknown>;
                                if (typeof parsed.streamCustomerSubdomain === 'string') {
                                    streamSubdomain = parsed.streamCustomerSubdomain;
                                }
                            } catch { /* ignore parse error — treat as empty */ }
                        }
                        videoProvider = streamSubdomain ? 'stream' : 'r2';
                    } else {
                        videoProvider = 'r2';
                    }
                }
            } catch (e) {
                logger.warn('[session-context] videoProvider resolution failed', { error: (e as Error).message });
            }
        }

        // Resolve the collaborative editing flag for this tenant. Plain per-tenant
        // operator toggle (not plan-gated); collab is now the default (#181 Phase 5,
        // after the photo data-loss gap was closed — every editor write routes
        // through the Y.Doc under collab). A tenant is collab-ON unless they have an
        // EXPLICIT stored `false` opt-out (the legacy CAS path stays available until
        // Tasks 14/15 retire it). So missing row / null / true → ON; only false → OFF.
        //
        // Fail mode: a DB error leaves `collabEditing` at its initial `false`
        // (fail-CLOSED to the legacy path). This is deliberate and intentionally
        // asymmetric with the happy-path default — a transient resolution failure
        // should not silently force a tenant onto collab; the legacy editor still
        // works without the Durable Object, so OFF is the safer fallback.
        let collabEditing = false;
        if (tenantId) {
            try {
                const db = drizzle(c.env.DB);
                const row = await db
                    .select({ collabEditing: tenantConfigs.collabEditing })
                    .from(tenantConfigs)
                    .where(eq(tenantConfigs.tenantId, tenantId))
                    .get();
                collabEditing = row?.collabEditing !== false;
            } catch (e) {
                logger.warn('[session-context] collabEditing resolution failed', { error: (e as Error).message });
            }
        }

        const privacyUrl = c.env.PRIVACY_URL?.trim() || null;

        return c.json({
            success: true,
            data: {
                branding: {
                    companyName: branding?.companyName || 'OpenInspection',
                    primaryColor: branding?.primaryColor || '#6366f1',
                    logoUrl: branding?.logoUrl || null,
                    reportTheme: branding?.reportTheme || 'modern',
                    isSaas: branding?.isSaas || false,
                    portalBaseUrl: branding?.portalBaseUrl || null,
                    tenantSlug: branding?.tenantSlug || null,
                    tenantStatus: branding?.tenantStatus || 'active',
                    currentUserSlug: branding?.currentUserSlug || null,
                    bookingHost: branding?.bookingHost || null,
                    privacyUrl,
                    defaultTimezone: tenantTimezone,
                },
                user: {
                    name: userName,
                    email: userEmail,
                    role: user.role || 'inspector',
                    initials,
                    timezone: userTimezone,
                },
                deployment: {
                    mode: profile.mode || 'standalone',
                    hasBilling: profile.hasBilling || false,
                    hasSeatQuota: profile.hasSeatQuota || false,
                    mcpEnabled: mcpEnabled(c.env as { MCP_ENABLED?: string }),
                },
                seatUsage,
                videoProvider,
                collabEditing,
            },
        });
    });

export type SessionContextApi = typeof sessionContextRoutes;

export default sessionContextRoutes;
