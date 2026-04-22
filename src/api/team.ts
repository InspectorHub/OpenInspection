import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { requireRole } from '../lib/middleware/rbac';
import { HonoConfig } from '../types/hono';
import { 
    InviteMemberSchema, 
    InviteResponseSchema, 
    TeamMembersResponseSchema 
} from '../lib/validations/admin.schema';

const teamRoutes = new OpenAPIHono<HonoConfig>();

/**
 * GET /api/team/members
 * Fetches active members and pending invitations for the workspace.
 */
const listTeamMembersRoute = createRoute({
    method: 'get',
    path: '/members',
    tags: ['Team'],
    summary: 'List team members and pending invites',
    middleware: [requireRole(['admin', 'owner', 'inspector', 'viewer'])],
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: TeamMembersResponseSchema,
                },
            },
            description: 'Success',
        },
    },
});

teamRoutes.openapi(listTeamMembersRoute, async (c) => {
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
});

/**
 * POST /api/team/invite
 * Invites a new team member to the workspace.
 */
const inviteTeamMemberRoute = createRoute({
    method: 'post',
    path: '/invite',
    tags: ['Team'],
    summary: 'Invite a new team member',
    middleware: [requireRole(['admin', 'owner'])],
    request: {
        body: {
            content: {
                'application/json': {
                    schema: InviteMemberSchema,
                },
            },
        },
    },
    responses: {
        201: {
            content: {
                'application/json': {
                    schema: InviteResponseSchema,
                },
            },
            description: 'Created',
        },
    },
});

teamRoutes.openapi(inviteTeamMemberRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const body = c.req.valid('json');
    const teamService = c.var.services.team;

    const { token, expiresAt } = await teamService.createInvite({
        tenantId,
        email: body.email,
        role: body.role,
    });

    const protocol = c.req.url.startsWith('https') ? 'https' : 'http';
    const host = c.req.header('host');
    const inviteLink = `${protocol}://${host}/join?token=${token}`;

    // Send email via service (requires RESEND_API_KEY in env)
    await teamService.sendInviteEmail(body.email, inviteLink);

    return c.json({ 
        success: true, 
        data: { 
            inviteLink, 
            expiresAt: expiresAt.toISOString() 
        } 
    }, 201);
});

export default teamRoutes;
