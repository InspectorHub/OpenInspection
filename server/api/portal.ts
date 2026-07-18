/**
 * Unified client portal — public API routes (no-password magic-link auth).
 *
 * All routes live under `/api/portal/:tenant`. Tenant is resolved from the
 * `:tenant` path slug by the `tenantRouter` middleware (the `/api/portal/`
 * prefix is whitelisted in resolve-by-path-param.ts), NOT from the host —
 * host→tenant resolution was retired (silo-deconvergence). Handlers read the
 * resolved tenant via `c.get('tenantId') || c.get('resolvedTenantId')` and
 * 404 when neither is set (unknown slug).
 *
 * Auth model:
 *   - request-link / redeem are UNAUTHENTICATED entry points.
 *   - me / inspections/* are gated by a `__Host-portal_session` cookie carrying
 *     ONLY a verified email (tenant-independent — email ownership is global).
 *     Cross-tenant isolation holds because every data query is tenant-scoped to
 *     the path's tenantId (see PortalService).
 *
 * Mirrors the conventions of server/api/repair-builder.ts (OpenAPIHono +
 * createRoute + withMcpMetadata + Zod `.describe()` on every field).
 */
import { createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { createApiRouter } from '../lib/openapi-router';
import { withMcpMetadata } from '../lib/route-metadata-standards';
import { signMagicLink, verifyMagicLink, verifyPortalSession, signPortalSession } from '../lib/portal-session';
import { resolvePortalAccess } from '../lib/public-access';
import { getBaseUrl } from '../lib/url';
import { logger } from '../lib/logger';
import type { HonoConfig } from '../types/hono';

const PORTAL_SESSION_COOKIE = '__Host-portal_session';

/** Resolves the path-derived tenantId, or null when the slug is unknown. */
function resolveTenantId(c: Context<HonoConfig>): string | null {
    return c.get('tenantId') || c.get('resolvedTenantId') || null;
}

// ---------------------------------------------------------------------------
// Session middleware (applied only to /me and /inspections/*)
// ---------------------------------------------------------------------------

/**
 * Reads + verifies the `__Host-portal_session` cookie. On success sets
 * `portalEmail` on the context; on missing/invalid returns 401. Tenant-agnostic
 * by design — the cookie carries only a verified email.
 */
async function portalSession(c: Context<HonoConfig>, next: () => Promise<void>) {
    const cookie = getCookie(c, PORTAL_SESSION_COOKIE);
    const verified = cookie ? await verifyPortalSession(c.env.JWT_SECRET, cookie) : null;
    if (!verified) {
        return c.json({ error: 'Not authenticated' }, 401);
    }
    c.set('portalEmail', verified.email);
    await next();
    return;
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const TenantParam = z.object({
    tenant: z.string().describe('Tenant slug (resolves the tenant from the URL path).'),
});

const RequestLinkBody = z.object({
    email: z.string().email().describe('Recipient email address requesting a portal magic-link.'),
});

const RecipientInspectionSchema = z.object({
    inspectionId:     z.string().describe('Inspection identifier the recipient can access.'),
    address:          z.string().describe('Property address for the inspection.'),
    date:             z.string().describe('Inspection date (ISO date string).'),
    inspectionStatus: z.string().describe('Lifecycle status of the inspection.'),
    reportPublished:  z.boolean().describe('Whether the report has been published.'),
    paymentStatus:    z.string().describe('Payment status of the inspection.'),
});

const HubOverviewSchema = z.object({
    address:          z.string().describe('Property address for the inspection.'),
    date:             z.string().describe('Inspection date (ISO date string).'),
    inspectionStatus: z.string().describe('Lifecycle status of the inspection.'),
    agreementSigned:  z.boolean().describe('Whether the inspection agreement is signed.'),
    paymentStatus:    z.string().describe('Payment status of the inspection.'),
    reportPublished:  z.boolean().describe('Whether the report has been published.'),
    progress:         z.object({
        completed: z.number().describe('Number of completed report items.'),
        total:     z.number().describe('Total number of report items.'),
    }).describe('Observation progress for the inspection report.'),
    unreadMessages:   z.number().describe('Count of unread inspector messages.'),
});

const HubOverviewResponseSchema = HubOverviewSchema.extend({
    token: z.string().describe('Persistent per-inspection access token for building section deep-links.'),
    signerToken: z.string().nullable().describe("The recipient's OWN agreement signer token (email-matched) for the inline Agreement section. Null when the recipient is not a signer."),
});

const ObserveSchema = z.object({
    address:        z.string().describe('Property address for the inspection.'),
    date:           z.string().nullable().describe('Inspection date (ISO date string), or null.'),
    inspectorName:  z.string().describe('Name of the assigned inspector.'),
    status:         z.string().describe('Lifecycle status of the inspection.'),
    sections:       z.array(z.object({
        name:           z.string().describe('Section title.'),
        totalItems:     z.number().describe('Total number of items in the section.'),
        completedItems: z.number().describe('Number of completed items in the section.'),
    })).describe('Per-section observation progress.'),
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const requestLinkRoute = createRoute(withMcpMetadata({
    method:  'post',
    path:    '/{tenant}/request-link',
    tags:    ['public'],
    summary: 'Request a portal magic-link by email',
    request: {
        params: TenantParam,
        body: {
            content: { 'application/json': { schema: RequestLinkBody } },
        },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ data: z.object({ sent: z.boolean().describe('Always true — response is identical (payload AND timing) whether or not the email is known; the magic-link send is deferred to waitUntil.') }) }) } },
            description: 'Magic-link request accepted (no email enumeration).',
        },
        404: { description: 'Tenant slug not found' },
    },
    operationId: 'portalRequestLink',
    description:
        'Requests a no-password magic-link for the unified client portal. ALWAYS returns ' +
        '200 with { sent: true } regardless of whether the email has any access grant, to ' +
        'prevent account enumeration. When the email owns a live client/co_client access ' +
        'token in this tenant, an email containing a signed magic-link is sent.',
}, { scopes: [], tier: 'extended' }));

const redeemRoute = createRoute(withMcpMetadata({
    method:  'get',
    path:    '/{tenant}/redeem',
    tags:    ['public'],
    summary: 'Validate a portal magic-link token',
    request: {
        params: TenantParam,
        query: z.object({
            link: z.string().describe('Signed magic-link token to validate.'),
        }),
    },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ data: z.object({ email: z.string().describe('Verified email carried by the magic-link.') }) }) } },
            description: 'Magic-link is valid; returns the verified email.',
        },
        401: { description: 'Magic-link missing, expired, or invalid' },
    },
    operationId: 'portalRedeemLink',
    description:
        'Validates a portal magic-link token (typ=ml). On success it sets the ' +
        '__Host-portal_session cookie (httpOnly/secure/SameSite=Lax) carrying the verified ' +
        'email and returns that email so the frontend can render. Bad/expired token → 401.',
}, { scopes: [], tier: 'extended' }));

const exchangeRoute = createRoute(withMcpMetadata({
    method:  'get',
    path:    '/{tenant}/exchange',
    tags:    ['public'],
    summary: 'Upgrade a per-inspection access token into a portal session',
    request: {
        params: TenantParam,
        query: z.object({
            token:        z.string().describe('Per-inspection client/co_client access token from an email CTA link.'),
            inspectionId: z.string().describe('Inspection identifier the access token is expected to grant.'),
        }),
    },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ data: z.object({ email: z.string().describe('Recipient email carried by the access token; also written into the session cookie.') }) }) } },
            description: 'Token valid for this tenant + inspection; session cookie set and email returned.',
        },
        401: { description: 'Access token missing, invalid, expired, revoked, or not for this inspection' },
        403: { description: 'Token resolves to a different tenant, or to a non-client (e.g. agent) role' },
        404: { description: 'Tenant slug not found' },
    },
    operationId: 'portalExchangeToken',
    description:
        'Exchanges a persistent per-(recipient, inspection) access token (the same family used ' +
        'by the public report links) for a __Host-portal_session cookie, so a client arriving ' +
        'from an email CTA lands in the portal already authenticated. Asserts the resolved ' +
        'grant tenant matches the path tenant AND the role is client/co_client (agent → 403).',
}, { scopes: [], tier: 'extended' }));

const logoutRoute = createRoute(withMcpMetadata({
    method:  'post',
    path:    '/{tenant}/logout',
    tags:    ['public'],
    summary: 'Sign out of the client portal',
    request: {
        params: TenantParam,
    },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ data: z.object({ ok: z.boolean().describe('Always true — the session cookie was cleared (idempotent).') }) }) } },
            description: 'Session cookie cleared.',
        },
    },
    operationId: 'portalLogout',
    description:
        'Signs the recipient out of the unified client portal by clearing the ' +
        '__Host-portal_session cookie. Idempotent and tenant-agnostic — clearing the cookie ' +
        'works regardless of whether a session exists or the slug resolves, so it is NOT ' +
        'behind the session middleware and always returns 200 { ok: true }.',
}, { scopes: [], tier: 'extended' }));

const meRoute = createRoute(withMcpMetadata({
    method:  'get',
    path:    '/{tenant}/me',
    tags:    ['public'],
    summary: 'List the signed-in recipient\'s inspections',
    request: {
        params: TenantParam,
    },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ data: z.object({
                email:       z.string().describe('Verified session email.'),
                inspections: z.array(RecipientInspectionSchema).describe('Inspections this recipient can access in this tenant.'),
            }) }) } },
            description: 'The session email plus its accessible inspections.',
        },
        401: { description: 'No valid portal session cookie' },
        404: { description: 'Tenant slug not found' },
    },
    operationId: 'portalMe',
    description:
        'Returns the session email plus every inspection the recipient can access in this ' +
        'tenant via a live client/co_client access token. Gated by the __Host-portal_session ' +
        'cookie; tenant is resolved from the path slug.',
}, { scopes: [], tier: 'extended' }));

const overviewRoute = createRoute(withMcpMetadata({
    method:  'get',
    path:    '/{tenant}/inspections/{inspectionId}/overview',
    tags:    ['public'],
    summary: 'Status overview for one accessible inspection',
    request: {
        params: TenantParam.extend({
            inspectionId: z.string().describe('Inspection identifier to fetch the overview for.'),
        }),
    },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ data: HubOverviewResponseSchema }) } },
            description: 'Six-dimension status snapshot for the inspection.',
        },
        401: { description: 'No valid portal session cookie' },
        403: { description: 'Inspection is not accessible to this recipient' },
        404: { description: 'Tenant slug or inspection not found' },
    },
    operationId: 'portalInspectionOverview',
    description:
        'Returns a six-dimension status snapshot (status / agreement / payment / report / ' +
        'progress / unread messages) for one inspection. Asserts the inspection is in the ' +
        'recipient\'s accessible set for this tenant+email before returning data (403 otherwise).',
}, { scopes: [], tier: 'extended' }));

const observeRoute = createRoute(withMcpMetadata({
    method:  'get',
    path:    '/{tenant}/inspections/{inspectionId}/observe',
    tags:    ['public'],
    summary: 'Per-section observe progress for an accessible inspection',
    request: {
        params: TenantParam.extend({
            inspectionId: z.string().describe('Inspection identifier to fetch observe progress for.'),
        }),
    },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ data: ObserveSchema }) } },
            description: 'Per-section progress for the inspection.',
        },
        401: { description: 'No valid portal session cookie' },
        403: { description: 'Inspection is not accessible to this recipient' },
        404: { description: 'Tenant slug or inspection not found' },
    },
    operationId: 'portalInspectionObserve',
    description:
        'Returns per-section observation progress (section name + total/completed items, plus ' +
        'address / date / inspector / status) for one inspection. Authenticated by the portal ' +
        'session — NOT the separate observer-link token. Asserts the inspection is in the ' +
        "recipient's accessible set for this tenant+email before returning data (403 otherwise). " +
        'Mirrors the overview endpoint so the Hub Progress section reads progress via the ' +
        'membership-checked portal session.',
}, { scopes: [], tier: 'extended' }));

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const portalRouter = createApiRouter();

// Session gate covers only the data routes (NOT request-link / redeem / exchange).
portalRouter.use('/:tenant/me', portalSession);
portalRouter.use('/:tenant/inspections/*', portalSession);

// IMPORTANT: capture the fluent `.openapi()` chain into the exported binding so
// `typeof portalRoutes` carries every registered route into PortalApi. Assigning
// the bare router (and applying `.openapi()` as discarded statements) would type
// the client surface as `unknown` — mirror repair-builder.ts here.
const portalRoutes = portalRouter
    .openapi(requestLinkRoute, async (c) => {
        const tenantId = resolveTenantId(c);
        if (!tenantId) return c.json({ error: 'Tenant not found' }, 404);

        const { email } = c.req.valid('json');

        // Look up whether this email has ANY live client/co_client grant in this
        // tenant. Same DB the PortalService reads (mocked to the test DB in unit
        // tests). Reuse listRecipientInspections to avoid duplicating the query.
        let known = false;
        try {
            const inspections = await c.var.services.portal.listRecipientInspections(tenantId, email);
            known = inspections.length > 0;
        } catch (err) {
            logger.error('[portal] request-link lookup failed', {}, err instanceof Error ? err : undefined);
        }

        if (known) {
            // Do NOT await the send inside the request: awaiting only on the
            // known path makes known emails respond measurably slower than
            // unknown ones, which is a timing enumeration oracle. Defer the work
            // to `waitUntil` so the response returns immediately in all cases.
            const sendPromise = (async () => {
                try {
                    const token = await signMagicLink(c.env.JWT_SECRET, email);
                    const baseUrl = getBaseUrl(c).replace(/\/$/, '');
                    const slug = c.get('requestedTenantSlug') || '';
                    const link = `${baseUrl}/portal/${slug}/auth?link=${encodeURIComponent(token)}`;
                    const safeLink = link.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
                    const html = `
                    <div style="font-family: -apple-system, system-ui, Segoe UI, Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #0f172a;">
                        <p style="font-size: 11px; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase; color: #64748b; margin: 0 0 4px;">Client Portal</p>
                        <h1 style="font-size: 22px; line-height: 1.25; font-weight: 600; margin: 0 0 16px;">Sign in to your portal</h1>
                        <p style="font-size: 14px; line-height: 1.5; color: #475569;">
                            Click the button below to access your inspections. This link expires in 15 minutes.
                        </p>
                        <p style="margin-top: 24px;">
                            <a href="${safeLink}" style="display: inline-block; padding: 10px 16px; background: #0f172a; color: white; text-decoration: none; border-radius: 6px; font-size: 13px; font-weight: 700;">Open my portal</a>
                        </p>
                        <p style="font-size: 12px; color: #94a3b8; margin-top: 24px;">If you didn't request this, you can safely ignore this email.</p>
                    </div>
                `;
                    await c.var.services.email.sendEmail([email], 'Sign in to your client portal', html);
                } catch (err) {
                    // Swallow send failures — never leak whether the email was known.
                    logger.error('[portal] magic-link send failed', {}, err instanceof Error ? err : undefined);
                }
            })();
            // `c.executionCtx` is the Hono Worker execution context (see di.ts).
            // Its getter THROWS when no execution context is present (e.g. unit
            // tests), so probe it defensively rather than via a truthiness check.
            // Only `waitUntil` is used; typed structurally so Hono's
            // `c.executionCtx` (whose ExecutionContext type lags
            // @cloudflare/workers-types) assigns without a version-skew error.
            let execCtx: Pick<ExecutionContext, 'waitUntil'> | undefined;
            try {
                execCtx = c.executionCtx;
            } catch {
                execCtx = undefined;
            }
            if (execCtx) execCtx.waitUntil(sendPromise);
            else await sendPromise;
        }

        // Identical response in all cases — timing-identical (send deferred to
        // waitUntil) AND payload-identical, so there is no enumeration oracle.
        return c.json({ data: { sent: true } }, 200);
    })
    .openapi(redeemRoute, async (c) => {
        const { link } = c.req.valid('query');
        const verified = await verifyMagicLink(c.env.JWT_SECRET, link);
        if (!verified) {
            return c.json({ error: 'Invalid or expired link' }, 401);
        }
        const sess = await signPortalSession(c.env.JWT_SECRET, verified.email);
        setCookie(c, PORTAL_SESSION_COOKIE, sess, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/' });
        return c.json({ data: { email: verified.email } }, 200);
    })
    .openapi(exchangeRoute, async (c) => {
        const tenantId = resolveTenantId(c);
        if (!tenantId) return c.json({ error: 'Tenant not found' }, 404);

        const { token, inspectionId } = c.req.valid('query');
        const grant = await resolvePortalAccess(c.var.services.portalAccess, token, inspectionId);
        if (!grant) return c.json({ error: 'Invalid or expired token' }, 401);

        // SECURITY: the token row is authoritative — it must point at THIS tenant
        // and carry a client/co_client role. Reject agents (and any mismatch) so
        // an agent's per-inspection token can never mint a client portal session.
        if (grant.tenantId !== tenantId || (grant.role !== 'client' && grant.role !== 'co_client')) {
            return c.json({ error: 'Forbidden' }, 403);
        }

        const sess = await signPortalSession(c.env.JWT_SECRET, grant.recipientEmail);
        setCookie(c, PORTAL_SESSION_COOKIE, sess, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/' });
        return c.json({ data: { email: grant.recipientEmail } }, 200);
    })
    .openapi(logoutRoute, async (c) => {
        // Tenant-agnostic + idempotent: clearing the cookie works regardless of
        // whether a session or a resolvable slug exists, so we do NOT gate on
        // resolveTenantId here. CLAUDE.md: deleteCookie on a `__Host-` cookie MUST
        // pass { path: '/', secure: true } or it throws at runtime.
        deleteCookie(c, PORTAL_SESSION_COOKIE, { path: '/', secure: true });
        return c.json({ data: { ok: true } }, 200);
    })
    .openapi(meRoute, async (c) => {
        const tenantId = resolveTenantId(c);
        if (!tenantId) return c.json({ error: 'Tenant not found' }, 404);
        const email = c.get('portalEmail') as string;

        const inspections = await c.var.services.portal.listRecipientInspections(tenantId, email);
        return c.json({ data: { email, inspections } }, 200);
    })
    .openapi(overviewRoute, async (c) => {
        const tenantId = resolveTenantId(c);
        if (!tenantId) return c.json({ error: 'Tenant not found' }, 404);
        const email = c.get('portalEmail') as string;
        const { inspectionId } = c.req.valid('param');

        // Membership check: the inspection must be in the recipient's accessible set.
        const accessible = await c.var.services.portal.listRecipientInspections(tenantId, email);
        if (!accessible.some((i) => i.inspectionId === inspectionId)) {
            return c.json({ error: 'Not accessible' }, 403);
        }

        // Resolve the recipient's STABLE per-inspection token so the Hub can build
        // section deep-links even for magic-link sessions (which carry no ?token).
        // issueToken is idempotent get-or-create; the membership check above already
        // guarantees a grant exists, so this returns that grant's token — no new row.
        let token = '';
        try {
            token = await c.var.services.portalAccess.issueToken({ tenantId, inspectionId, recipientEmail: email });
        } catch (err) {
            logger.error('[portal] overview token issue failed', {}, err instanceof Error ? err : undefined);
        }

        // Resolve THIS recipient's OWN agreement signer token (email-matched) so
        // the inline Agreement section can mount. SECURITY: getSignerLinkByEmail
        // matches on the verified session email and NEVER returns a different
        // signer's token. Best-effort (null on failure / non-signer recipient).
        let signerToken: string | null = null;
        try {
            signerToken = await c.var.services.agreement.getSignerLinkByEmail(tenantId, inspectionId, email);
        } catch (err) {
            logger.error('[portal] overview signer token resolve failed', {}, err instanceof Error ? err : undefined);
        }

        const overview = await c.var.services.portal.hubOverview(tenantId, inspectionId);
        if (!overview) return c.json({ error: 'Inspection not found' }, 404);
        return c.json({ data: { ...overview, token, signerToken } }, 200);
    })
    .openapi(observeRoute, async (c) => {
        const tenantId = resolveTenantId(c);
        if (!tenantId) return c.json({ error: 'Tenant not found' }, 404);
        const email = c.get('portalEmail') as string;
        const { inspectionId } = c.req.valid('param');

        // Membership check (EXACTLY as overview): the inspection must be in the
        // recipient's accessible set before any observe data is returned.
        const accessible = await c.var.services.portal.listRecipientInspections(tenantId, email);
        if (!accessible.some((i) => i.inspectionId === inspectionId)) {
            return c.json({ error: 'Not accessible' }, 403);
        }

        // Tenant + inspection scoped server-side; NO observer-link token needed.
        const observe = await c.var.services.portal.observeProgress(tenantId, inspectionId);
        if (!observe) return c.json({ error: 'Inspection not found' }, 404);
        return c.json({ data: observe }, 200);
    });

export type PortalApi = typeof portalRoutes;

export default portalRoutes;
