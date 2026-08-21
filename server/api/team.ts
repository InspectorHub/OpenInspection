import { createRoute } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { z } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import { requireRole } from '../lib/middleware/rbac';
import { requireCapability } from '../lib/middleware/require-capability';
import { exportPayroll } from '../services/pay-split.service';
import { PayrollExportSchema, PayrollRunResponseSchema } from '../lib/validations/pay-split.schema';
import { requireSeatAvailable } from '../features/seat-quota';
import { getBaseUrl } from '../lib/url';
import { tenantConfigs } from '../lib/db/schema';
import { auditFromContext } from '../lib/audit';
import {
    InviteMemberSchema,
    UpdateMemberSchema,
    InviteResponseSchema,
    TeamMembersResponseSchema,
    TeamDefaultsSchema
} from '../lib/validations/admin.schema';
import { createApiResponseSchema } from '../lib/validations/shared.schema';
import { withMcpMetadata } from "../lib/route-metadata-standards";
import { getDrizzle } from '../lib/route-helpers';

/**
 * POST /api/team/payroll-export — the company-level half of #278.
 *
 * Lives on the TEAM router rather than under an inspection because a payroll
 * run spans a period and everyone in it, and because `server/index.ts` sits at
 * its size cap so a new top-level mount would hard-fail the file-size ratchet
 * for no gain. Payroll is staff administration; this is the
 * staff-administration surface.
 *
 * Gated on `financial` and not on a new `payroll` bit: the competitor evidence
 * put the line at "sees the company's money", and a second flag that nothing
 * else reads is a permission nobody would maintain.
 *
 * A NAMED const, not inlined into the chain — `check-idempotency-coverage.mjs`
 * resolves `.openapi(IDENT)` and cannot see a route written inline. Exporting
 * LOCKS every row it returns, so an unguarded retry hands the operator an empty
 * run and the money reads as unowed; that route may not be invisible to the
 * retry-safety ledger.
 */
const exportPayrollRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/payroll-export',
    operationId: 'exportTeamPayroll',
    tags: ['team'],
    summary: 'Lock and export pay for a period',
    description: 'Locks every unlocked pay split created inside the given period and returns them as one payroll run. Locking IS the export: once money has moved an edit would desynchronise the books from what was actually paid, so a later adjustment has to be recorded as a correction row instead.',
    middleware: [requireRole('owner', 'manager'), requireCapability('financial')] as const,
    request: { body: { content: { 'application/json': { schema: PayrollExportSchema } } } },
    responses: {
        200: { content: { 'application/json': { schema: PayrollRunResponseSchema } }, description: 'The pay rows this run locked' },
    },
}, { scopes: ['admin'], tier: 'extended', capability: 'financial' }));

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
 * PATCH /api/team/members/:id
 * Changes a member's role and/or capability overrides (IA-101). owner/manager
 * only, same tier as invite/remove — this grants and revokes power.
 */
const updateTeamMemberRoute = createRoute(withMcpMetadata({
    method: 'patch',
    path: '/members/{id}',
    tags: ["team"],
    summary: 'Update a team member\'s role or permissions',
    description: 'Changes role and/or capability overrides for an active member. A role change also invalidates the member\'s sessions and MCP grants, since the role is a JWT claim. Refuses to demote the last owner, to change your own role, or to assign the agent role (agents are granted per-inspection access, not seats).',
    middleware: [requireRole('manager', 'owner')],
    request: {
        params: z.object({ id: z.string().trim().min(1).describe('The member\'s user id.') }),
        body: { content: { 'application/json': { schema: UpdateMemberSchema } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: createApiResponseSchema(z.object({ updated: z.boolean() })) } },
            description: 'Member updated',
        },
        400: { description: 'Last owner, self role-change, or agent role requested' },
        404: { description: 'Member not found in this tenant' },
    },
    operationId: "updateTeamMember",
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
        params: z.object({ id: z.string().trim().min(1).describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
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

/**
 * DELETE /api/team/invites/:token
 * Cancels a pending seat invite (inspector or in-house agent). owner/manager
 * only — seats carry billing implications.
 */
const cancelInviteRoute = createRoute(withMcpMetadata({
    method: 'delete',
    path: '/invites/{token}',
    tags: ["team"],
    summary: 'Cancel a pending seat invite',
    description: 'Hard-deletes a pending tenant_invites row that belongs to the caller tenant. 404 when the token is unknown, already accepted, or belongs to another tenant.',
    middleware: [requireRole('manager', 'owner')],
    request: {
        params: z.object({ token: z.string().trim().min(1).describe('The pending invite token (tenant_invites.id).') }),
    },
    responses: {
        200: {
            content: { 'application/json': { schema: createApiResponseSchema(z.object({ cancelled: z.boolean() })) } },
            description: 'Invite cancelled',
        },
        404: { description: 'Invite not found / not pending / cross-tenant' },
    },
    operationId: "cancelTeamInvite",
}, { scopes: ['write'], tier: 'extended' }));

/**
 * POST /api/team/invites/:token/resend
 * Re-sends the invitation email for an existing pending invite. Same token,
 * same 7-day expiry — no new row. owner/manager only.
 */
const resendInviteRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/invites/{token}/resend',
    tags: ["team"],
    summary: 'Resend a pending seat invite email',
    description: 'Re-sends the invitation email for an existing pending tenant_invites row. 404 when the token is unknown, accepted, or cross-tenant.',
    middleware: [requireRole('manager', 'owner')],
    request: {
        params: z.object({ token: z.string().trim().min(1).describe('The pending invite token (tenant_invites.id).') }),
    },
    responses: {
        200: {
            content: { 'application/json': { schema: createApiResponseSchema(z.object({ resent: z.boolean() })) } },
            description: 'Invitation email re-sent',
        },
        404: { description: 'Invite not found / not pending / cross-tenant' },
    },
    operationId: "resendTeamInvite",
}, { scopes: ['write'], tier: 'extended' }));

// ─── Design System 0520 subsystem C P10.2 — team defaults ──
// `TeamDefaultsSchema` lives in lib/validations/admin/settings.ts: this endpoint
// writes `tenant_configs`, and the write allowlist in
// lib/tenant-config-write-policy.ts derives the column from that shape.

const teamRoutes = createApiRouter()
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

        // Who added whom to this company, on the durable record. The
        // `user.invited` outbox event this handler also produces is a
        // replication receipt with a two-cycle life; it answers "did the other
        // side get it", not "who did this".
        //
        // No entityId: `tenant_invites.id` IS the join token that appears in
        // the link below, so writing it here would park a live credential in a
        // table an audit UI reads. No email either -- metadata is redacted by
        // value shape at write time, so an address would be stripped anyway,
        // and the invite row already holds it.
        auditFromContext(c, 'user.invite', 'user', {
            metadata: { role: body.role },
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
    .openapi(updateTeamMemberRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const user = c.get('user');
        const { id: memberId } = c.req.valid('param');
        const body = c.req.valid('json');

        await c.var.services.team.updateMember({
            tenantId,
            userId: memberId,
            requesterId: user?.sub as string,
            ...(body.role ? { role: body.role } : {}),
            ...(body.permissionOverrides !== undefined ? { permissionOverrides: body.permissionOverrides } : {}),
        });

        return c.json({ success: true as const, data: { updated: true as const } }, 200);
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
    .openapi(cancelInviteRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const { token } = c.req.valid('param');
        await c.var.services.team.cancelInvite(tenantId, token);
        return c.json({ success: true as const, data: { cancelled: true as const } }, 200);
    })
    .openapi(resendInviteRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const { token } = c.req.valid('param');
        const invite = await c.var.services.team.findPendingInvite(tenantId, token);
        if (!invite) return c.json({ success: false as const, error: { code: 'NOT_FOUND', message: 'Invite not found' } }, 404);
        const inviteLink = `${getBaseUrl(c)}/join?token=${token}`;
        await c.var.services.email.sendInvitation(invite.email, inviteLink);
        return c.json({ success: true as const, data: { resent: true as const } }, 200);
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
        const db = getDrizzle(c);
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
        request: { body: { content: { 'application/json': { schema: TeamDefaultsSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } } },
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
    })
    .openapi(exportPayrollRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const { fromMs, toMs } = c.req.valid('json');
        const rows = await exportPayroll(getDrizzle(c), tenantId, { fromMs, toMs });
        return c.json({
            success: true as const,
            data: {
                lockedCount: rows.length,
                totalCents:  rows.reduce((sum, r) => sum + r.amountCents, 0),
                splits:      rows.map(r => ({
                    id: r.id, inspectionServiceId: r.inspectionServiceId, userId: r.userId,
                    amountCents: r.amountCents, source: r.source,
                    lockedAtMs: r.lockedAt === null ? null : Number(r.lockedAt),
                    correctsSplitId: r.correctsSplitId, reason: r.reason,
                    createdAtMs: Number(r.createdAt), updatedAtMs: Number(r.updatedAt),
                })),
            },
        }, 200);
    });

export type TeamApi = typeof teamRoutes;

export default teamRoutes;
