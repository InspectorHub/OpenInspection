import { createRoute } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { z } from '@hono/zod-openapi';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and, count, inArray } from 'drizzle-orm';
import { requireRole } from '../lib/middleware/rbac';
import { requireSeatAvailable } from '../features/seat-quota';
import { getBaseUrl } from '../lib/url';
import { Errors } from '../lib/errors';
import { tenantConfigs, users, apprenticeReviews, inspections } from '../lib/db/schema';
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
    middleware: [requireRole('admin', 'owner', 'inspector')],
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
    middleware: [requireRole('admin', 'owner'), requireSeatAvailable],
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
    middleware: [requireRole('admin', 'owner')],
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

// ============================================================================
// Design System 0520 subsystem C phase 3 — apprentice review queue routes.
// ============================================================================
// Mentor-facing endpoints used by /apprentice-review (HTML page mounted
// separately). list returns this mentor's pending queue; decide closes
// a single row and (on approve / edit) applies the value to
// inspection_results via patchItem(force: true).

const listApprenticeReviewsRoute = createRoute(withMcpMetadata({
    method:     'get',
    path:       '/apprentice-reviews',
    tags: ["team"],
    summary:    "List the caller's pending apprentice reviews",
    middleware: [requireRole('owner', 'admin', 'inspector')] as const,
    responses:  { 200: { description: 'ok' } },
    operationId: "listTeamApprenticeReviews",
    description: "Auto-generated placeholder for listTeamApprenticeReviews (GET /apprentice-reviews, team domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' }));

const decideApprenticeReviewRoute = createRoute(withMcpMetadata({
    method:     'post',
    path:       '/apprentice-reviews/{id}/decide',
    tags: ["team"],
    summary:    'Approve / reject / edit an apprentice-submitted item field',
    middleware: [requireRole('owner', 'admin', 'inspector')] as const,
    request: {
        params: z.object({ id: z.string().min(1).describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
        body: { content: { 'application/json': { schema: z.object({
            action:        z.enum(['approved', 'rejected', 'edited']).describe('TODO describe action field for the OpenInspection MCP integration'),
            decisionValue: z.unknown().optional().describe('TODO describe decisionValue field for the OpenInspection MCP integration'),
        }).describe('TODO describe schema field for the OpenInspection MCP integration') } } },
    },
    responses: { 200: { description: 'ok' }, 404: { description: 'review not found' } },
    operationId: "createTeamApprenticeReviewsDecide",
    description: "Auto-generated placeholder for createTeamApprenticeReviewsDecide (POST /apprentice-reviews/{id}/decide, team domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

// ─── Design System 0520 subsystem C P10.2 — defaults / apprentices ──

const DefaultsSchema = z.object({
    teamModeDefault:          z.boolean().optional().describe('TODO describe teamModeDefault field for the OpenInspection MCP integration'),
    apprenticeReviewRequired: z.boolean().optional().describe('TODO describe apprenticeReviewRequired field for the OpenInspection MCP integration'),
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
            ...(body.mentorId           ? { mentorId: body.mentorId }                   : {}),
            ...(body.assignedSectionIds ? { assignedSectionIds: body.assignedSectionIds } : {}),
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
    .openapi(listApprenticeReviewsRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const user     = c.get('user') as { sub?: string } | undefined;
        if (!user?.sub) throw Errors.Unauthorized('Missing user identity');

        const rows = await c.var.services.apprentice.listPendingForMentor(tenantId, user.sub);
        if (rows.length === 0) {
            return c.json({ success: true as const, data: [] }, 200);
        }

        // UI enrichment — the /apprentice-review page needs the apprentice's
        // name and the inspection's property address to be usable. Two batched
        // queries (one per join) keep this O(1) instead of N+1.
        const db = drizzle(c.env.DB);
        const typedRows = rows as Array<{ apprenticeId: string; inspectionId: string } & Record<string, unknown>>;
        const apprenticeIds: string[] = [...new Set(typedRows.map((r) => r.apprenticeId))];
        const inspectionIds: string[] = [...new Set(typedRows.map((r) => r.inspectionId))];

        const apprenticeRows = await db
            .select({ id: users.id, name: users.name })
            .from(users)
            .where(and(eq(users.tenantId, tenantId), inArray(users.id, apprenticeIds)))
            .all();
        const inspectionRows = await db
            .select({ id: inspections.id, address: inspections.propertyAddress })
            .from(inspections)
            .where(and(eq(inspections.tenantId, tenantId), inArray(inspections.id, inspectionIds)))
            .all();

        const apprenticeNameById: Record<string, string | null> = Object.fromEntries(apprenticeRows.map((a) => [a.id, a.name]));
        const inspectionAddrById: Record<string, string | null> = Object.fromEntries(inspectionRows.map((i) => [i.id, i.address]));

        const items = typedRows.map((r) => ({
            ...r,
            apprenticeName:    apprenticeNameById[r.apprenticeId] ?? 'Unknown apprentice',
            inspectionAddress: inspectionAddrById[r.inspectionId] ?? r.inspectionId,
        }));

        return c.json({ success: true as const, data: items }, 200);
    })
    .openapi(decideApprenticeReviewRoute, async (c) => {
        const { id } = c.req.valid('param');
        const { action, decisionValue } = c.req.valid('json');
        const tenantId = c.get('tenantId');
        const user     = c.get('user') as { sub?: string } | undefined;
        if (!user?.sub) throw Errors.Unauthorized('Missing user identity');

        const out = await c.var.services.apprentice.decide(tenantId, id, action, decisionValue);
        if (out.kind === 'not_found') throw Errors.NotFound('Review not found');

        // If approved or edited, apply the value to inspection_results via the
        // canonical patchItem path with force: true (bypasses version check
        // since mentor's decision is authoritative).
        if (action === 'approved' || action === 'edited') {
            const review = await c.var.services.apprentice.getById(tenantId, id);
            if (review) {
                const sourceJson = action === 'edited' ? review.decisionValue : review.proposedValue;
                let finalValue: unknown = null;
                try { finalValue = sourceJson ? JSON.parse(sourceJson) : null; } catch { /* keep null */ }
                await c.var.services.inspection.patchItem(
                    review.inspectionId,
                    tenantId,
                    review.itemId,
                    review.field as 'rating' | 'notes' | 'value',
                    finalValue,
                    0,
                    review.apprenticeId,
                    { force: true },
                );
            }
        }

        return c.json({ success: true as const, data: { reviewId: id, action } }, 200);
    })
    /** GET /api/team/defaults — read the team-page toggles. */
    .openapi(withMcpMetadata({
        method: 'get', path: '/defaults',
        operationId: 'getTeamDefaults',
        tags: ['team'],
        summary: "Get tenant team-page default toggles",
        description: "Returns the boolean toggles that govern the team page: teamModeDefault, apprenticeReviewRequired. Used to drive UI state.",
        middleware: [requireRole('owner', 'admin', 'inspector')] as const,
        responses: { 200: { description: 'ok' } },
    }, { scopes: ['read'], tier: 'extended' }), async (c) => {
        const tenantId = c.get('tenantId');
        const db = drizzle(c.env.DB);
        const row = await db.select({
            teamModeDefault:          tenantConfigs.teamModeDefault,
            apprenticeReviewRequired: tenantConfigs.apprenticeReviewRequired,
        }).from(tenantConfigs).where(eq(tenantConfigs.tenantId, tenantId)).get();
        return c.json({
            success: true as const,
            data: row ?? {
                teamModeDefault:          false,
                apprenticeReviewRequired: false,
            },
        }, 200);
    })
    /** PUT /api/team/defaults — patch any subset of the three toggles. */
    .openapi(withMcpMetadata({
        method: 'put', path: '/defaults',
        operationId: 'updateTeamDefaults',
        tags: ['team'],
        summary: "Update tenant team-page default toggles",
        description: "Patches any subset of the team-page toggles (teamModeDefault, apprenticeReviewRequired). Missing keys leave existing values unchanged.",
        middleware: [requireRole('owner', 'admin')] as const,
        request: { body: { content: { 'application/json': { schema: DefaultsSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } } },
        responses: { 200: { description: 'ok' } },
    }, { scopes: ['admin'], tier: 'extended' }), async (c) => {
        const tenantId = c.get('tenantId');
        const body = c.req.valid('json');
        const update: Partial<typeof tenantConfigs.$inferInsert> = {};
        if (body.teamModeDefault          !== undefined) update.teamModeDefault          = body.teamModeDefault;
        if (body.apprenticeReviewRequired !== undefined) update.apprenticeReviewRequired = body.apprenticeReviewRequired;

        if (Object.keys(update).length > 0) {
            await c.var.services.branding.updateBranding(tenantId, update);
        }
        return c.json({ success: true as const, data: { ok: true as const } }, 200);
    })
    /**
     * GET /api/team/apprentices — list every apprentice in the tenant
     * with their mentor's name + a pending-review count. Drives the
     * Apprentices section on /team.
     */
    .openapi(withMcpMetadata({
        method: 'get', path: '/apprentices',
        operationId: 'listTeamApprentices',
        tags: ['team'],
        summary: 'List apprentices with mentor and review counts',
        description: 'Returns every apprentice in the tenant along with their mentor name and pending-review count. Drives the Apprentices section of the team page.',
        middleware: [requireRole('owner', 'admin', 'inspector')] as const,
        responses: { 200: { description: 'ok' } },
    }, { scopes: ['read'], tier: 'extended' }), async (c) => {
        const tenantId = c.get('tenantId');
        const db = drizzle(c.env.DB);

        const apprentices = await db.select({
            id:       users.id,
            name:     users.name,
            email:    users.email,
            mentorId: users.mentorId,
        }).from(users)
            .where(and(eq(users.tenantId, tenantId), eq(users.role, 'apprentice')))
            .all();

        // Hydrate mentor names + pending counts. N+1 is acceptable here —
        // tenants typically have a handful of apprentices, not hundreds.
        const items = await Promise.all(apprentices.map(async a => {
            const mentor = a.mentorId
                ? await db.select({ name: users.name, email: users.email })
                    .from(users).where(eq(users.id, a.mentorId)).get()
                : null;
            const pending = await db.select({ value: count() })
                .from(apprenticeReviews)
                .where(and(
                    eq(apprenticeReviews.tenantId, tenantId),
                    eq(apprenticeReviews.apprenticeId, a.id),
                    eq(apprenticeReviews.status, 'pending'),
                )).get();
            return {
                id:          a.id,
                name:        a.name ?? a.email,
                mentorName:  mentor?.name ?? mentor?.email ?? null,
                pendingCount: pending?.value ?? 0,
            };
        }));

        return c.json({ success: true as const, data: items }, 200);
    });

export type TeamApi = typeof teamRoutes;

export default teamRoutes;
