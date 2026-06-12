/**
 * Design System 0520 subsystem C phase 6 — anonymous guest claim route.
 *
 * `POST /api/guest/claim` runs without a JWT. The caller proves
 * authorisation by presenting the random invite `token` minted by an
 * admin via `POST /api/team/guests` (Phase 6 task 6.2). We look up the
 * invite to discover the tenant, pull the tenant's seat quota from
 * `tenants.max_users`, and delegate to `GuestInviteService.claim`.
 *
 * This route is JWT-exempt: the JWT middleware in `server/index.ts` adds
 * `/api/guest/` to its public-path list.
 */
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { Errors } from '../lib/errors';
import { sendSuccess } from '../lib/response';
import { withMcpMetadata } from "../lib/route-metadata-standards";
import { getLegalLinks, buildTermsAcceptedBlob } from '../lib/legal-links';

const claimRoute = createRoute(withMcpMetadata({
    method:  'post',
    path:    '/claim',
    tags: ["guest"],
    summary: 'Anonymously claim a guest invite token',
    request: {
        body: { content: { 'application/json': { schema: z.object({
            token:    z.string().min(20).max(128).describe('TODO describe token field for the OpenInspection MCP integration'),
            name:     z.string().min(1).max(100).describe('TODO describe name field for the OpenInspection MCP integration'),
            email:    z.string().email().describe('TODO describe email field for the OpenInspection MCP integration'),
            password: z.string().min(8).max(128).describe('TODO describe password field for the OpenInspection MCP integration'),
            // Legal-links feature — required (true) only when the operator configured
            // TERMS_URL/PRIVACY_URL; enforced in the handler, optional on the wire.
            termsAccepted: z.boolean().optional().describe('Acceptance of operator Terms of Service and Privacy Policy; required when the operator has configured TERMS_URL/PRIVACY_URL'),
        }).describe('TODO describe schema field for the OpenInspection MCP integration') } } },
    },
    responses: {
        200: {
            description: 'Claim succeeded',
            content: { 'application/json': { schema: z.object({
                success: z.boolean().describe('TODO describe success field for the OpenInspection MCP integration'),
                data:    z.object({ userId: z.string().describe('TODO describe userId field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration'),
            }) } },
        },
        400: { description: 'Invalid input' },
        402: { description: 'Tenant at seat cap' },
        404: { description: 'Not found / expired / already claimed' },
    },
    operationId: "createGuestClaim",
    description: "Auto-generated placeholder for createGuestClaim (POST /claim, guest domain). TODO: replace with a real description sourced from the handler."
}, { scopes: [], tier: 'extended' }));

// C-10 ③-B — GET /api/guest/invite-info?token= — preview the workspace + role
// a guest invite grants, for the /guest-join accept page (JWT-exempt, like claim).
const inviteInfoRoute = createRoute(withMcpMetadata({
    method:  'get',
    path:    '/invite-info',
    tags: ["guest"],
    summary: 'Resolve a guest invite token for the accept page',
    request: { query: z.object({ token: z.string().describe('Guest invite token from the URL.') }) },
    responses: {
        200: {
            description: 'Invite preview',
            content: { 'application/json': { schema: z.object({
                success: z.boolean().describe('Always true on the 200 path.'),
                data:    z.object({
                    workspaceName: z.string().describe('Inviting workspace name.'),
                    role:          z.string().describe('Role the invite grants (lead/specialist/apprentice/office).'),
                    expiresAt:     z.number().describe('Invite expiry (unix epoch seconds).'),
                }).describe('Guest invite preview.'),
            }) } },
        },
        404: { description: 'Not found / expired / already claimed' },
    },
    operationId: "getGuestInviteInfo",
    description: "Public, no-login resolution of a guest invite token into the workspace name + granted role + expiry for the /guest-join page. 404 for unknown/expired/claimed tokens.",
}, { scopes: [], tier: 'extended' }));

export const guestRoutes = createApiRouter()
    .openapi(inviteInfoRoute, async (c) => {
        const { token } = c.req.valid('query');
        const info = await c.var.services.guestInvite.getInviteInfo(token);
        if (!info) throw Errors.NotFound('Invalid or expired invite token');
        return sendSuccess(c, info);
    })
    .openapi(claimRoute, async (c) => {
        const body = c.req.valid('json');

        const links = getLegalLinks(c.env);
        if (links && body.termsAccepted !== true) {
            throw Errors.BadRequest('You must accept the terms to create an account.');
        }

        // Resolve the invite's tenant + seat cap before the service call so we
        // can pass maxUsers without touching ScopedDB (which needs a JWT we
        // don't have on this route). Hash-aware — the token is stored hashed.
        const resolved = await c.var.services.guestInvite.resolveTenantForToken(body.token);
        if (!resolved) throw Errors.NotFound('Invalid or unknown invite token');

        const out = await c.var.services.guestInvite.claim(body.token, body, {
            maxUsers: resolved.maxUsers,
            enforceSeatQuota: c.var.profile.hasSeatQuota,
            ...(links ? { termsAccepted: buildTermsAcceptedBlob(links, {
                ip: c.req.header('CF-Connecting-IP'),
                country: (c.req.raw.cf?.country as string | undefined),
            }) } : {}),
        });

        switch (out.kind) {
            case 'ok':
                return sendSuccess(c, { userId: out.userId });
            case 'expired':
                throw Errors.NotFound('Invite has expired');
            case 'claimed':
                throw Errors.NotFound('Invite has already been claimed');
            case 'not_found':
                throw Errors.NotFound('Invalid or unknown invite token');
            case 'over_quota':
                throw Errors.SeatLimitReached({ used: resolved.maxUsers, max: resolved.maxUsers, billingPortalUrl: null });
            case 'invalid':
                throw Errors.Validation({ reason: out.reason });
        }
    });

export type GuestApi = typeof guestRoutes;

export default guestRoutes;
