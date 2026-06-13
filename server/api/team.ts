import { createRoute } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { z } from '@hono/zod-openapi';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { requireRole } from '../lib/middleware/rbac';
import { requireSeatAvailable } from '../features/seat-quota';
import { getBaseUrl } from '../lib/url';
import { tenantConfigs } from '../lib/db/schema';
import {
    InviteMemberSchema,
    InviteResponseSchema,
    TeamMembersResponseSchema
} from '../lib/validations/admin.schema';
import { createApiResponseSchema } from '../lib/validations/shared.schema';
import { withMcpMetadata } from "../lib/route-metadata-standards";

/**
 * GET /api/team/members
 * Fetches active members and pending invitations for the workspace.
 */
const listTeamMembersRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/members',
    tags: ["team"],
    summary: 'List team members and pending invites',
    middleware: [requireRole('manager', 'owner', 'inspector')],
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: TeamMembersResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
            description: 'Success',
        },
    },
    operationId: "listTeamMembers",
    description: "Auto-generated placeholder for listTeamMembers (GET /members, team domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' }));

/**
 * POST /api/team/invite
 * Invites a new team member to the workspace.
 */
const inviteTeamMemberRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/invite',
    tags: ["team"],
    summary: 'Invite a new team member',
    middleware: [requireRole('manager', 'owner'), requireSeatAvailable],
    request: {
        body: {
            content: {
                'application/json': {
                    schema: InviteMemberSchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
        },
    },
    responses: {
        201: {
            content: {
                'application/json': {
                    schema: InviteResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
            description: 'Created',
        },
    },
    operationId: "inviteTeam",
    description: "Auto-generated placeholder for inviteTeam (POST /invite, team domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

/**
 * DELETE /api/team/members/:id
 * Removes a team member and invalidates their sessions.
 */
const removeTeamMemberRoute = createRoute(withMcpMetadata({
    method: 'delete',
    path: '/members/{id}',
    tags: ["team"],
    summary: 'Remove a team member',
    middleware: [requireRole('manager', 'owner')],
    request: {
        params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: createApiResponseSchema(z.object({ removed: z.boolean().describe('TODO describe removed field for the OpenInspection MCP integration') })),
                },
            },
            description: 'Member removed',
        },
    },
    operationId: "deleteTeamMember",
    description: "Auto-generated placeholder for deleteTeamMember (DELETE /members/{id}, team domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

// ─── Design System 0520 subsystem C P10.2 — team defaults ──

const DefaultsSchema = z.object({
    teamModeDefault:          z.boolean().optional().describe('TODO describe teamModeDefault field for the OpenInspection MCP integration'),
});

export const teamRoutes = createApiRouter()
    .openapi(listTeamMembersRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const teamService = c.var.services.team;
        const { activeUsers, pendingInvites, maxUsers } = await teamService.getMembers(tenantId);

        return c.json({
            success: true,
            data: {
                members: activeUsers,
                invites: pendingInvites,
                maxUsers,
            }
        }, 200);
    })
    .openapi(inviteTeamMemberRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const body = c.req.valid('json');
        const teamService = c.var.services.team;

        const { token, expiresAt } = await teamService.createInvite({
            tenantId,
            email: body.email,
            role:  body.role,
            permissionOverrides: body.permissionOverrides ?? null,
        });

        const inviteLink = `${getBaseUrl(c)}/join?token=${token}`;

        // Send email via service (requires RESEND_API_KEY in env)
        await c.var.services.email.sendInvitation(body.email, inviteLink);

        return c.json({
            success: true,
            data: {
                inviteLink,
                expiresAt: expiresAt.toISOString()
            }
        }, 201);
    })
    .openapi(removeTeamMemberRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const user = c.get('user');
        const requesterId = user?.sub as string;
        const { id: memberId } = c.req.valid('param');

        const teamService = c.var.services.team;
        const authService = c.var.services.auth;

        await teamService.removeMember(tenantId, memberId, requesterId);

        // Invalidate the deleted user's sessions so their cookie becomes invalid immediately
        await authService.invalidateUserSessions(memberId);

        return c.json({ success: true, data: { removed: true } }, 200);
    })
    /** GET /api/team/defaults — read the team-page toggles. */
    .openapi(withMcpMetadata({
        method: 'get', path: '/defaults',
        operationId: 'getTeamDefaults',
        tags: ['team'],
        summary: "Get tenant team-page default toggles",
        description: "Returns the boolean toggles that govern the team page: teamModeDefault. Used to drive UI state.",
        middleware: [requireRole('owner', 'manager', 'inspector')] as const,
        responses: { 200: { description: 'ok' } },
    }, { scopes: ['read'], tier: 'extended' }), async (c) => {
        const tenantId = c.get('tenantId');
        const db = drizzle(c.env.DB);
        const row = await db.select({
            teamModeDefault:          tenantConfigs.teamModeDefault,
        }).from(tenantConfigs).where(eq(tenantConfigs.tenantId, tenantId)).get();
        return c.json({
            success: true as const,
            data: row ?? {
                teamModeDefault:          false,
            },
        }, 200);
    })
    /** PUT /api/team/defaults — patch any subset of the toggles. */
    .openapi(withMcpMetadata({
        method: 'put', path: '/defaults',
        operationId: 'updateTeamDefaults',
        tags: ['team'],
        summary: "Update tenant team-page default toggles",
        description: "Patches any subset of the team-page toggles (teamModeDefault). Missing keys leave existing values unchanged.",
        middleware: [requireRole('owner', 'manager')] as const,
        request: { body: { content: { 'application/json': { schema: DefaultsSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } } },
        responses: { 200: { description: 'ok' } },
    }, { scopes: ['admin'], tier: 'extended' }), async (c) => {
        const tenantId = c.get('tenantId');
        const body = c.req.valid('json');
        const update: Partial<typeof tenantConfigs.$inferInsert> = {};
        if (body.teamModeDefault          !== undefined) update.teamModeDefault          = body.teamModeDefault;

        if (Object.keys(update).length > 0) {
            await c.var.services.branding.updateBranding(tenantId, update);
        }
        return c.json({ success: true as const, data: { ok: true as const } }, 200);
    });

export type TeamApi = typeof teamRoutes;

export default teamRoutes;
