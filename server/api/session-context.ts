import {} from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { and, eq } from 'drizzle-orm';
import { users, tenantConfigs, tenants } from '../lib/db/schema';
import { getSeatUsage } from '../features/seat-quota';
import { resolveLocale } from '../lib/locale';
import {
    DEFAULT_DISPLAY_PREFS,
    isDateFormat,
    isTimeFormat,
    type DateFormat,
    type TimeFormat,
} from '../lib/session/display-prefs';
import { Errors } from '../lib/errors';
import { logger } from '../lib/logger';
import { mcpEnabled } from '../lib/mcp/flag';
import { coerceOverrides, getCapabilities, type CapabilitySet } from '../lib/auth/capabilities';
import { isRole } from '../lib/auth/roles';
import type { DeploymentProfile } from '../lib/deployment-profile';

/**
 * Which deployment capabilities the browser is sent.
 *
 * An explicit allowlist, not a spread of the whole profile: it also carries
 * `fixedTenantId` and the portal URLs, which are the server's business.
 *
 * It is a NAMED function so a spec can assert on what ships. The list used to
 * be four fields written inline, and a capability that is not on it is not
 * merely undocumented in the client — it is UNREADABLE there. That is not a
 * hypothetical: `library-hub.tsx` and `CommandPalette.tsx` both gate the
 * marketplace on `branding.isSaas` while `marketplace.tsx` gates it on
 * `hasContentMarketplace`, and the reason is simply that the capability had
 * never been put on the wire. The wrong answer was the only reachable one.
 */
export function deploymentPayload(
    profile: DeploymentProfile,
    env: { MCP_ENABLED?: string },
) {
    return {
        mode: profile.mode || 'standalone',
        hasBilling: profile.hasBilling || false,
        hasSeatQuota: profile.hasSeatQuota || false,
        mcpEnabled: mcpEnabled(env),
        hasContentMarketplace: profile.hasContentMarketplace || false,
        videoBackendManaged: profile.videoBackendManaged || false,
        hasManagedCompliance: profile.hasManagedCompliance || false,
        // The BOOLEAN only, never the three import caps beside it on the
        // profile. Those are the grounds on which the server refuses; shipping
        // them would invite the browser to re-decide the same question, and two
        // implementations of one limit eventually disagree. The client shows
        // whatever sentence the server sent back with the refusal.
        hasAssistedMigration: profile.hasAssistedMigration || false,
    };
}
import { getDrizzle } from '../lib/route-helpers';
import { getBaseUrl } from '../lib/url';
import { resolveTenantLegalUrls, type LegalMode } from '../lib/legal-links';
import { resolveVideoProvider, videoStreamServiceable } from '../services/video/resolve';
import { unlockAtMs } from '../lib/email/outbound-cooling-window';

/**
 * Portal #98 item 3 — is the outbound cooling window OPEN for this viewer, and
 * when does it close?
 *
 * The server answers both, and ships only the instant. If the client also
 * decided "open", the two could disagree across a clock skew and the banner
 * would either linger after sends work or vanish while they still fail.
 *
 * `null` means "nothing to say", covering three different situations on
 * purpose: self-hosted (no window exists), elapsed (no window remains), and
 * unreadable anchor (we do not know, and guessing would put a banner in front
 * of someone whose sends work fine).
 */
export function resolveCoolingWindowForSession(input: {
    mode: string;
    createdAt: Date | null | undefined;
    nowMs: number;
}): { unlockAtMs: number } | null {
    if (input.mode !== 'saas' || !input.createdAt) return null;
    const unlock = unlockAtMs(input.createdAt.getTime());
    return input.nowMs < unlock ? { unlockAtMs: unlock } : null;
}

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
const sessionContextRoutes = createApiRouter()
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
        let userLocale: string | null = null;
        // #270 — the raw stored values, not the resolved pair: the client hook
        // owns resolution, exactly as it already does for timezone and locale.
        let userDateFormat: DateFormat | null = null;
        let userTimeFormat: TimeFormat | null = null;
        let tenantDateFormat: DateFormat = DEFAULT_DISPLAY_PREFS.dateFormat;
        let tenantTimeFormat: TimeFormat = DEFAULT_DISPLAY_PREFS.timeFormat;
        // RESOLVED capabilities, not the raw overrides: whether an actor may do
        // something is decided where it is ENFORCED, and shipping the answer
        // rather than the ingredients means the chrome cannot resolve it a
        // second, subtly different way (see Cross-Portal Reuse in CLAUDE.md).
        let permissionOverridesRaw: unknown = null;
        let tenantTimezone = 'UTC';
        let tenantLocale = 'en-US';
        let tenantCurrency = 'USD';
        let archiveRevokesAccess = false;
        let legalCfg: {
            legalMode: LegalMode;
            customPrivacyUrl: string | null;
            customTermsUrl: string | null;
        } | null = null;
        if (tenantId) {
            try {
                const db = getDrizzle(c);
                const row = await db.select({
                    name: users.name,
                    email: users.email,
                    timezone: users.timezone,
                    locale: users.locale,
                    dateFormat: users.dateFormat,
                    timeFormat: users.timeFormat,
                    permissionOverrides: users.permissionOverrides,
                })
                    .from(users)
                    .where(and(eq(users.id, user.sub), eq(users.tenantId, tenantId)))
                    .get();
                if (row) {
                    userName = row.name;
                    userEmail = row.email;
                    permissionOverridesRaw = row.permissionOverrides;
                    userTimezone = row.timezone;
                    userLocale = row.locale;
                    userDateFormat = isDateFormat(row.dateFormat) ? row.dateFormat : null;
                    userTimeFormat = isTimeFormat(row.timeFormat) ? row.timeFormat : null;
                }
                const cfg = await db.select({
                    defaultTimezone: tenantConfigs.defaultTimezone,
                    defaultLocale: tenantConfigs.defaultLocale,
                    currency: tenantConfigs.currency,
                    dateFormat: tenantConfigs.dateFormat,
                    timeFormat: tenantConfigs.timeFormat,
                    // IA-100 — the contacts archive dialog states whether
                    // archiving also revokes report links, so it needs the
                    // policy, not just the link count.
                    archiveRevokesAccess: tenantConfigs.archiveRevokesAccess,
                    legalMode: tenantConfigs.legalMode,
                    customPrivacyUrl: tenantConfigs.customPrivacyUrl,
                    customTermsUrl: tenantConfigs.customTermsUrl,
                })
                    .from(tenantConfigs)
                    .where(eq(tenantConfigs.tenantId, tenantId))
                    .get();
                if (cfg?.defaultTimezone) tenantTimezone = cfg.defaultTimezone;
                tenantLocale = resolveLocale(cfg?.defaultLocale);
                if (cfg?.currency) tenantCurrency = cfg.currency;
                if (isDateFormat(cfg?.dateFormat)) tenantDateFormat = cfg.dateFormat;
                if (isTimeFormat(cfg?.timeFormat)) tenantTimeFormat = cfg.timeFormat;
                archiveRevokesAccess = cfg?.archiveRevokesAccess ?? false;
                legalCfg = cfg
                    ? {
                        legalMode: (cfg.legalMode as LegalMode | null) ?? 'hosted',
                        customPrivacyUrl: cfg.customPrivacyUrl,
                        customTermsUrl: cfg.customTermsUrl,
                    }
                    : null;
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
        //
        // Calls the same resolver the media-studio API uses. This used to be a
        // 40-line copy annotated "Mirror resolveVideoBackend" — which it did not:
        // on a misconfigured stream tenant the copy reported 'r2' while the API
        // threw 503, so the editor offered a capture path every upload refused.
        let videoProvider: 'r2' | 'stream' = 'r2';
        if (tenantId) {
            try {
                const resolved = await resolveVideoProvider(c, tenantId, getDrizzle(c));
                videoProvider = videoStreamServiceable(resolved) ? 'stream' : 'r2';
            } catch (e) {
                logger.warn('[session-context] videoProvider resolution failed', { error: (e as Error).message });
            }
        }

        // Portal #98 item 3 — the open outbound cooling window, so the chrome can
        // say so before anyone presses Send.
        //
        // This is its OWN read of `tenants`, and that is not an oversight. The
        // plan for this feature assumed the block above still selected the tenant
        // row here and that `createdAt` could ride along for free; it does not —
        // that read now lives inside `resolveVideoProvider`, which fetches
        // tier/status only on the managed branch and owns the video question, not
        // this one. Widening a video resolver's return type to carry an email
        // anchor would couple two unrelated concerns to save one primary-key
        // lookup. So: one indexed read by primary key, and only where a window
        // can exist at all — standalone pays nothing.
        //
        // Fail-open, matching the send gate: an unreadable anchor leaves this
        // null, so a D1 blip never puts a banner in front of someone whose sends
        // work fine.
        let outboundCoolingWindow: { unlockAtMs: number } | null = null;
        if (tenantId && profile.mode === 'saas') {
            try {
                const tenantRow = await getDrizzle(c)
                    .select({ createdAt: tenants.createdAt })
                    .from(tenants)
                    .where(eq(tenants.id, tenantId))
                    .get();
                outboundCoolingWindow = resolveCoolingWindowForSession({
                    mode: profile.mode, createdAt: tenantRow?.createdAt, nowMs: Date.now(),
                });
            } catch (e) {
                logger.warn('[session-context] cooling-window anchor read failed', { error: (e as Error).message });
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
                const db = getDrizzle(c);
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

        const tenantSlug = branding?.tenantSlug?.trim() || null;
        let privacyUrl: string | null = null;
        let termsUrl: string | null = null;
        if (tenantSlug) {
            const links = resolveTenantLegalUrls(tenantSlug, getBaseUrl(c), legalCfg);
            privacyUrl = links.privacyUrl;
            termsUrl = links.termsUrl;
        }

        let unreadMessages = 0;
        try {
            unreadMessages = await c.var.services.message.unreadCountForTenant(tenantId);
        } catch { /* badge degrades to 0; the layout must never fail on it */ }

        // An unknown role resolves as an inspector rather than throwing: the
        // chrome must still render, and inspector is the least-privileged tier.
        const roleForCaps = isRole(user.role) ? user.role : 'inspector';
        const capabilities: CapabilitySet = getCapabilities(
            roleForCaps,
            coerceOverrides(permissionOverridesRaw),
        );

        return c.json({
            success: true,
            data: {
                branding: {
                    companyName: branding?.companyName || 'OpenInspection',
                    primaryColor: branding?.primaryColor || '#6366f1',
                    logoUrl: branding?.logoUrl || null,
                    defaultProfileId: branding?.defaultProfileId || 'signature',
                    isSaas: branding?.isSaas || false,
                    portalBaseUrl: branding?.portalBaseUrl || null,
                    tenantSlug: branding?.tenantSlug || null,
                    tenantStatus: branding?.tenantStatus || 'active',
                    currentUserSlug: branding?.currentUserSlug || null,
                    bookingHost: branding?.bookingHost || null,
                    privacyUrl,
                    termsUrl,
                    defaultTimezone: tenantTimezone,
                    defaultLocale: tenantLocale,
                    currency: tenantCurrency,
                    archiveRevokesAccess,
                    dateFormat: tenantDateFormat,
                    timeFormat: tenantTimeFormat,
                },
                user: {
                    name: userName,
                    email: userEmail,
                    role: user.role || 'inspector',
                    capabilities,
                    initials,
                    timezone: userTimezone,
                    locale: userLocale,
                    dateFormat: userDateFormat,
                    timeFormat: userTimeFormat,
                },
                deployment: deploymentPayload(profile, c.env as { MCP_ENABLED?: string }),
                seatUsage,
                videoProvider,
                outboundCoolingWindow,
                collabEditing,
                // Track D — the sidebar Messages badge. One indexed count
                // (idx_msg_unread) per layout load; refreshes on navigation.
                unreadMessages,
            },
        });
    });

export type SessionContextApi = typeof sessionContextRoutes;

export default sessionContextRoutes;
