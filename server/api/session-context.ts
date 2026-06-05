import {} from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { drizzle } from 'drizzle-orm/d1';
import { and, eq } from 'drizzle-orm';
import { users } from '../lib/db/schema';
import { getSeatUsage } from '../features/seat-quota';
import { Errors } from '../lib/errors';
import { logger } from '../lib/logger';

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

        // Look up the user's name and email from DB
        let userName: string | null = null;
        let userEmail: string | null = null;
        if (tenantId) {
            try {
                const db = drizzle(c.env.DB);
                const row = await db.select({ name: users.name, email: users.email })
                    .from(users)
                    .where(and(eq(users.id, user.sub), eq(users.tenantId, tenantId)))
                    .get();
                if (row) {
                    userName = row.name;
                    userEmail = row.email;
                }
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

        const privacyUrl = (c.env as unknown as Record<string, string | undefined>).PRIVACY_URL?.trim() || null;

        return c.json({
            success: true,
            data: {
                branding: {
                    siteName: branding?.siteName || 'OpenInspection',
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
                },
                user: {
                    name: userName,
                    email: userEmail,
                    role: user.role || 'inspector',
                    initials,
                },
                deployment: {
                    mode: profile.mode || 'standalone',
                    hasBilling: profile.hasBilling || false,
                    hasSeatQuota: profile.hasSeatQuota || false,
                },
                seatUsage,
            },
        });
    });

export type SessionContextApi = typeof sessionContextRoutes;

export default sessionContextRoutes;
