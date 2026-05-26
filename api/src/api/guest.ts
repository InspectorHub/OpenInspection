/**
 * Design System 0520 subsystem C phase 6 — anonymous guest claim route.
 *
 * `POST /api/guest/claim` runs without a JWT. The caller proves
 * authorisation by presenting the random invite `token` minted by an
 * admin via `POST /api/team/guests` (Phase 6 task 6.2). We look up the
 * invite to discover the tenant, pull the tenant's seat quota from
 * `tenants.max_users`, and delegate to `GuestInviteService.claim`.
 *
 * This route is JWT-exempt: the JWT middleware in `src/index.ts` adds
 * `/api/guest/` to its public-path list.
 */
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { guestInvites, tenants } from '../lib/db/schema';
import { Errors } from '../lib/errors';
import { sendSuccess } from '../lib/response';
import type { HonoConfig } from '../types/hono';
import { withMcpMetadata } from "../lib/route-metadata-standards";

export const guestRoutes = new OpenAPIHono<HonoConfig>();

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

guestRoutes.openapi(claimRoute, async (c) => {
    const body = c.req.valid('json');
    const db   = drizzle(c.env.DB);

    // Look up the invite to discover which tenant it belongs to. We do
    // this before the service call so the 404 path stays cheap and so we
    // can fetch the tenant's seat cap without touching ScopedDB (which
    // needs a JWT we don't have on this route).
    const invite = await db.select().from(guestInvites)
        .where(eq(guestInvites.token, body.token))
        .get();
    if (!invite) throw Errors.NotFound('Invalid or unknown invite token');

    const tenant = await db.select().from(tenants)
        .where(eq(tenants.id, invite.tenantId))
        .get();
    if (!tenant) throw Errors.NotFound('Invite tenant no longer exists');

    const out = await c.var.services.guestInvite.claim(body.token, body, {
        maxUsers: tenant.maxUsers,
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
            throw Errors.SeatLimitReached({ used: tenant.maxUsers, max: tenant.maxUsers, billingPortalUrl: null });
        case 'invalid':
            throw Errors.Validation({ reason: out.reason });
    }
});

export default guestRoutes;
