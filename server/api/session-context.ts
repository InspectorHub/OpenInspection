import { createRoute } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import type { ApiOf } from '../lib/api-schema';
import { withMcpMetadata } from '../lib/route-metadata-standards';
import { SessionContextResponseSchema } from '../lib/validations/session-context.schema';
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
import { sessionMarker } from '../lib/session-marker';
import { logger } from '../lib/logger';
import { deploymentPayload } from '../lib/session/deployment-payload';
import { coerceOverrides, getCapabilities, type CapabilitySet } from '../lib/auth/capabilities';
import { isRole, isAdminRole } from '../lib/auth/roles';
import { ALL_INSPECTIONS, scopeFromCapabilities } from '../lib/inspection/visibility';

export { deploymentPayload };
import { getDrizzle } from '../lib/route-helpers';
import { getBaseUrl } from '../lib/url';
import { resolveTenantLegalUrls, type LegalMode } from '../lib/legal-links';
import { resolveVideoProvider, videoStreamServiceable } from '../services/video/resolve';
import { unlockAtMs } from '../lib/email/outbound-cooling-window';
import { resolveTurnstileSiteKey } from '../lib/middleware/bot-protection';

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
const sessionContextRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/context', operationId: 'getSessionContext', tags: ['client'],
    summary: 'Get branding, user and deployment context for the session',
    description: 'Returns the company branding and display defaults, the signed-in user with resolved capabilities, the deployment flags the interface gates on, seat usage, video provider, outbound cooling window and unread message count. Requires a signed-in session; the answer is never cached.',
    responses: {
        200: { description: 'Session context', content: { 'application/json': { schema: SessionContextResponseSchema } } },
        401: { description: 'Authentication required' },
    },
}, { scopes: [], tier: 'excluded' }));

const sessionContextRoutes = createApiRouter();
sessionContextRoutes.openapi(sessionContextRoute, async (c) => {
    const user = c.get('user');
    if (!user?.sub) {
        throw Errors.Unauthorized('Authentication required');
    }
    // Who is signed in, tenant settings and capabilities: never stored by a shared cache or the
    // service worker (the page asks again on every load).
    c.header('Cache-Control', 'private, no-store');

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
    // Null until the tenant_configs read below answers. The platform default
    // is applied once, at the payload, so "unset" and "unreadable" stay
    // distinguishable up to that point.
    let tenantCompanyName: string | null = null;
    let holidayRegion: string | null = null;
    let archiveRevokesAccess = false;
    // Resolved inside the tenant_configs read below. Fail mode: a DB error
    // leaves this `false` (fail-CLOSED to the legacy editor). Deliberately
    // asymmetric with the happy-path default -- a transient failure should
    // not silently force a tenant onto collab.
    let collabEditing = false;
    let legalCfg: {
        legalMode: LegalMode;
        customPrivacyUrl: string | null;
        customTermsUrl: string | null;
    } | null = null;
    if (tenantId) {
        try {
            const db = getDrizzle(c);
            // One wave: the two reads are independent, and a sequential
            // await is a round trip. `collabEditing` used to be a THIRD
            // select of this same tenant_configs row further down; it rides
            // along here instead -- same row, same tenant, one statement.
            const [row, cfg] = await Promise.all([
                db.select({
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
                    .get(),
                db.select({
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
                    collabEditing: tenantConfigs.collabEditing,
                    // ⚠️ READ HERE RATHER THAN OFF `c.get('branding')`, and
                    // the reason is the early return at the top of
                    // `middleware/branding.ts`: that middleware is mounted
                    // BEFORE jwtAuthMiddleware, so on a saas authenticated
                    // request it has no `tenantId` and hands back platform
                    // defaults. Every saas workspace was therefore told its
                    // own company name was 'OpenInspection' — which is why
                    // the Getting started checklist's first step could never
                    // be completed on saas, however many times the name was
                    // saved. This query has the JWT's tenantId and is the
                    // same row the name lives on.
                    companyName: tenantConfigs.companyName,
                    // The only structured statement a workspace makes about
                    // where it works ('US' or 'US-TX'). Set for the holiday
                    // catalogue; read by the New Inspection template picker
                    // so a workspace is not offered another state's
                    // statutory form first (app/lib/template-order.ts).
                    holidayRegion: tenantConfigs.holidayRegion,
                })
                    .from(tenantConfigs)
                    .where(eq(tenantConfigs.tenantId, tenantId))
                    .get(),
            ]);
            // Missing row / null / true → ON; only an explicit stored false
            // is an opt-out. A read failure leaves the initial `false`
            // (fail-CLOSED to the legacy editor) via the catch below.
            collabEditing = cfg?.collabEditing !== false;
            if (row) {
                userName = row.name;
                userEmail = row.email;
                permissionOverridesRaw = row.permissionOverrides;
                userTimezone = row.timezone;
                userLocale = row.locale;
                userDateFormat = isDateFormat(row.dateFormat) ? row.dateFormat : null;
                userTimeFormat = isTimeFormat(row.timeFormat) ? row.timeFormat : null;
            }
            if (cfg?.defaultTimezone) tenantTimezone = cfg.defaultTimezone;
            // Blank and whitespace are both "never set" to a reader, and
            // only one of them is null.
            const storedCompanyName = cfg?.companyName?.trim();
            if (storedCompanyName) tenantCompanyName = storedCompanyName;
            holidayRegion = cfg?.holidayRegion ?? null;
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

    // An unknown role resolves as an inspector rather than throwing: the
    // chrome must still render, and inspector is the least-privileged tier.
    const roleForCaps = isRole(user.role) ? user.role : 'inspector';
    const capabilities: CapabilitySet = getCapabilities(
        roleForCaps,
        coerceOverrides(permissionOverridesRaw),
    );

    // The tenant row serves two answers on a saas-profile deployment: the video
    // provider (tier/status) and the cooling-window anchor (createdAt). It
    // is one primary-key read, started once and shared by both. Where
    // neither question exists (standalone) nothing is read.
    const needsTenantRow = !!tenantId && (profile.mode === 'saas' || !!profile.videoBackendManaged);
    // Wrapped in a real Promise: a drizzle query is a lazy thenable that
    // would run once per consumer.
    const tenantRow = needsTenantRow
        ? Promise.resolve(getDrizzle(c)
            .select({ tier: tenants.tier, status: tenants.status, createdAt: tenants.createdAt })
            .from(tenants)
            .where(eq(tenants.id, tenantId))
            .get())
        : null;

    // ONE wave. These four answers do not depend on each other (the unread
    // count needs the capabilities resolved just above, not any other read),
    // and each degrades on its own failure, so a slow or failing one never
    // delays or breaks the rest.
    const [seatUsage, videoProvider, outboundCoolingWindow, unreadMessages] = await Promise.all([
        // Seat usage (only for profiles that enforce seat quotas)
        (async (): Promise<{ used: number; limit: number } | null> => {
            if (!profile.hasSeatQuota || !tenantId) return null;
            try {
                const usage = await getSeatUsage(tenantId, c.env.DB);
                return usage.max !== null ? { used: usage.used, limit: usage.max } : null;
            } catch (e) {
                logger.warn('[session-context] seat usage lookup failed', { error: (e as Error).message });
                return null;
            }
        })(),
        // The video provider the editor renders (VideoCapture/VideoPlayer). It calls
        // the same resolver the media-studio API uses; a hand-kept copy once said 'r2'
        // where the API threw 503, so the editor offered a path every upload refused.
        (async (): Promise<'r2' | 'stream'> => {
            if (!tenantId) return 'r2';
            try {
                const resolved = await resolveVideoProvider(c, tenantId, getDrizzle(c), { tenantRow });
                return videoStreamServiceable(resolved) ? 'stream' : 'r2';
            } catch (e) {
                logger.warn('[session-context] videoProvider resolution failed', { error: (e as Error).message });
                return 'r2';
            }
        })(),
        // The open outbound cooling window, so the chrome can
        // say so before anyone presses Send. Only where a window can exist at all
        // (saas); standalone pays nothing. Fail-open, matching the send gate: an
        // unreadable anchor leaves this null, so a D1 blip never puts a banner in
        // front of someone whose sends work fine.
        (async (): Promise<{ unlockAtMs: number; turnstileSiteKey: string | null } | null> => {
            if (!tenantId || profile.mode !== 'saas' || !tenantRow) return null;
            try {
                const row = await tenantRow;
                const open = resolveCoolingWindowForSession({
                    mode: profile.mode, createdAt: row?.createdAt, nowMs: Date.now(),
                });
                // The site key rides along so the web app can ask for the
                // challenge before a send, matched to the secret the API verifies with.
                return open ? { ...open, turnstileSiteKey: resolveTurnstileSiteKey(c.env) } : null;
            } catch (e) {
                logger.warn('[session-context] cooling-window anchor read failed', { error: (e as Error).message });
                return null;
            }
        })(),
        // Counted over what this caller can see, from the capabilities just resolved.
        (async (): Promise<number> => {
            try {
                const scope = isAdminRole(roleForCaps) ? ALL_INSPECTIONS : scopeFromCapabilities(user.sub, capabilities);
                return await c.var.services.message.unreadCountForTenant(tenantId, scope);
            } catch { return 0; /* badge degrades to 0; the layout must never fail on it */ }
        })(),
    ]);

    const tenantSlug = branding?.tenantSlug?.trim() || null;
    let privacyUrl: string | null = null;
    let termsUrl: string | null = null;
    if (tenantSlug) {
        const links = resolveTenantLegalUrls(tenantSlug, getBaseUrl(c), legalCfg);
        privacyUrl = links.privacyUrl;
        termsUrl = links.termsUrl;
    }

    return c.json({
        success: true as const,
        data: {
            branding: {
                // The stored name first — see the query above for why
                // `branding` cannot answer this on saas.
                companyName: tenantCompanyName || branding?.companyName || 'OpenInspection',
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
                holidayRegion,
                defaultLocale: tenantLocale,
                currency: tenantCurrency,
                archiveRevokesAccess,
                dateFormat: tenantDateFormat,
                timeFormat: tenantTimeFormat,
            },
            user: {
                // Opaque marker of this user, for the browser's service worker (see session-marker.ts).
                sessionMarker: await sessionMarker(user.sub),
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
            deployment: deploymentPayload(profile, c.env as { MCP_ENABLED?: string; NATIVE_CLIENT_ENABLED?: string }),
            seatUsage,
            videoProvider,
            outboundCoolingWindow,
            collabEditing,
            // Track D — the sidebar Messages badge. One indexed count
            // (idx_msg_unread) per layout load; refreshes on navigation.
            unreadMessages,
        },
    }, 200);
});

/** Registration order; drives the typed client and is pinned to the router by a test. */
export const sessionContextRouteConfigs = [sessionContextRoute] as const;

export type SessionContextApi = ApiOf<typeof sessionContextRouteConfigs>;

export default sessionContextRoutes;
