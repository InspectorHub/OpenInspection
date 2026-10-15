import { createRoute } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { z } from '@hono/zod-openapi';
import { requireRole } from '../lib/middleware/rbac';
import { isAdminRole } from '../lib/auth/roles';
import { requireCapability } from '../lib/middleware/require-capability';
import { exportPayroll } from '../services/pay-split.service';
import { PayrollExportSchema, PayrollRunResponseSchema } from '../lib/validations/pay-split.schema';
import { requireSeatAvailable } from '../features/seat-quota';
import { inviteAcceptUrl } from '../lib/url';
import { auditFromContext } from '../lib/audit';
import { assertMayTouchOwner } from '../lib/auth/owner-guard';
import {
    InviteMemberSchema,
    UpdateMemberSchema,
    InviteResponseSchema,
    TeamMembersResponseSchema
} from '../lib/validations/admin.schema';
import { createApiResponseSchema } from '../lib/validations/shared.schema';
import { withMcpMetadata } from "../lib/route-metadata-standards";
import { getDrizzle } from '../lib/route-helpers';
import teamDefaultsRoutes from './team-defaults';
import teamTwoFactorRoutes from './team-two-factor';

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
                    schema: TeamMembersResponseSchema,
                },
            },
            description: 'Success',
        },
    },
    operationId: "listTeamMembers",
    description: "Lists the company's team: members (non-removed users) with id, name, email, role, permission overrides, whether two-factor sign-in is enabled (the flag only, never secrets), creation time and last active time; the pending invitations, each with its accept link, returned only to owner and manager callers (an inspector gets an empty invites list, because the accept link is a bearer credential for the invited role); and maxUsers, the seat cap (3 when the company has none recorded). Accepted, expired or cancelled invitations are not listed. Not paginated. Read-only. Available to owner, manager and inspector roles; invitations are included for owner and manager only."
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
                    schema: InviteMemberSchema.describe('Who to invite, the role they get and whether to email the invitation.'),
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
        403: { description: 'Only an owner can invite someone as an owner' },
    },
    operationId: "inviteTeam",
    description: "Invite a person to join the team. Creates a pending invite that expires after 7 days and returns its accept link and expiry. The invitation email is sent unless notify is false, in which case nothing is sent and the caller must deliver the returned inviteLink. Role and the optional permissionOverrides are stored on the invite and applied when it is accepted; only an owner may invite someone as an owner (403). Returns 409 when the email already belongs to an active member and is refused when no seat is free under the seat limit, when one applies. Writes a user.invite audit entry. Each call creates another invite. Restricted to owners and managers."
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
    description: 'Changes role and/or capability overrides for an active member. A role change also invalidates the member\'s sessions and MCP grants, since the role is a JWT claim. Refuses to demote the last owner, to change your own role, or to assign the agent role (agents are granted per-inspection access, not seats). Only an owner may change an owner or promote anyone to owner.',
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
        403: { description: 'Caller is not an owner but the target is, or the new role is, owner' },
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
        params: z.object({ id: z.string().trim().min(1).describe('User id of the member to remove.') }),
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: createApiResponseSchema(z.object({ removed: z.boolean() })),
                },
            },
            description: 'Member removed',
        },
        403: { description: 'Caller is not an owner but the member is' },
    },
    operationId: "deleteTeamMember",
    description: "Remove a member from the team. The user is soft-deleted rather than erased, so inspections attributed to them and their report history stay intact, and the same email can be invited again later. Their live sessions and any MCP access grants are revoked immediately, and a user.deleted event is queued for the sync outbox when one is configured. Returns 400 when you try to remove yourself or the last owner, 404 for an unknown or already removed member, and 403 when the target is an owner and the caller is not. Restricted to owners and managers."
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

const teamRoutes = createApiRouter()
    // `/defaults` lives in its own file — see team-defaults.ts for why.
    .route('/', teamDefaultsRoutes)
    // Account recovery, mounted here so the path stays /api/team/members/... .
    .route('/', teamTwoFactorRoutes)
    .openapi(listTeamMembersRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const teamService = c.var.services.team;
        const { activeUsers, pendingInvites, maxUsers } = await teamService.getMembers(tenantId);
        // The invite id IS the accept token (POST /api/auth/join), so the list is
        // a bearer credential for the invited role. Only the roles that can send
        // invitations may see it; anyone else gets members and the seat cap only.
        const role = c.get('userRole');
        const mayViewInvites = isAdminRole(role);

        return c.json({
            success: true,
            data: {
                members: activeUsers,
                invites: mayViewInvites
                    ? pendingInvites.map((invite) => ({
                        ...invite,
                        inviteLink: inviteAcceptUrl(c, invite.id),
                    }))
                    : [],
                maxUsers,
            }
        }, 200);
    })
    .openapi(inviteTeamMemberRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const body = c.req.valid('json');
        const teamService = c.var.services.team;

        // The invited role is copied onto the new user at accept time, so
        // inviting as owner is minting an owner. Same rule as update/remove.
        assertMayTouchOwner(c.get('userRole'), 'inspector', body.role);

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

        const inviteLink = inviteAcceptUrl(c, token);

        // Send email via service (requires RESEND_API_KEY in env), unless the
        // caller is delivering the link themselves.
        //
        // The flag defaults to true, so every existing caller is unaffected.
        // It is only honourable at all because `inviteLink` comes back in the
        // response AND the pending row can produce it again later: an invite
        // with no email and no link is not a quiet invite, it is one nobody can
        // accept. The drawer's checkbox spent a long time promising this
        // without sending the flag, which is how it came to be implemented.
        if (body.notify) {
            await c.var.services.email.sendInvitation(body.email, inviteLink);
        }

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
            requesterRole: c.get('userRole'),
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

        await teamService.removeMember(tenantId, memberId, requesterId, c.get('userRole'));

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
        const inviteLink = inviteAcceptUrl(c, token);
        await c.var.services.email.sendInvitation(invite.email, inviteLink);
        return c.json({ success: true as const, data: { resent: true as const } }, 200);
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
