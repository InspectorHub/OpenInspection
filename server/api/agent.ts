import { createRoute } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { z } from '@hono/zod-openapi';
import { drizzle } from 'drizzle-orm/d1';
import { and, eq, sql } from 'drizzle-orm';
import { requireRole } from '../lib/middleware/rbac';
import { inspections } from '../lib/db/schema/inspection';
import { contacts } from '../lib/db/schema/contact';
import { Errors } from '../lib/errors';
import {
    AgentReportsQuerySchema,
    AgentReportsResponseSchema,
    LeaderboardResponseSchema,
    AgentProfilePatchSchema,
    AgentProfilePatchResponseSchema,
    ConciergeBookSchema,
    ConciergeBookResponseSchema,
} from '../lib/validations/agent.schema';
import { withMcpMetadata } from "../lib/route-metadata-standards";

/**
 * GET /api/agents/my-reports
 * Agent or admin can view referral reports.
 */
const getReportsRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/my-reports',
    tags: ["agents"],
    summary: "List agent my reports",
    request: {
        query: AgentReportsQuerySchema.describe('TODO describe query field for the OpenInspection MCP integration'),
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: AgentReportsResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
            description: 'Success',
        },
        401: { description: 'Unauthorized' },
        403: { description: 'Forbidden' },
    },
    security: [{ bearerAuth: [] }],
    operationId: "listAgentMyReports",
    description: "Auto-generated placeholder for listAgentMyReports (GET /my-reports, agents domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['agent'], tier: 'extended' }));

/**
 * UC-A-5 — agent's flattened recommendations grouped by safety / recommendation /
 * maintenance. Pulls from referred-and-delivered inspections only; access is
 * scoped via the same agent_tenant_links predicate as listReferrals.
 */
const RecommendationRowSchema = z.object({
    inspectionId:    z.string().describe('TODO describe inspectionId field for the OpenInspection MCP integration'),
    propertyAddress: z.string().describe('TODO describe propertyAddress field for the OpenInspection MCP integration'),
    inspectionDate:  z.string().describe('TODO describe inspectionDate field for the OpenInspection MCP integration'),
    sectionTitle:    z.string().describe('TODO describe sectionTitle field for the OpenInspection MCP integration'),
    itemLabel:       z.string().describe('TODO describe itemLabel field for the OpenInspection MCP integration'),
    defectTitle:     z.string().describe('TODO describe defectTitle field for the OpenInspection MCP integration'),
    category:        z.enum(['safety', 'recommendation', 'maintenance']).describe('TODO describe category field for the OpenInspection MCP integration'),
    comment:         z.string().describe('TODO describe comment field for the OpenInspection MCP integration'),
    location:        z.string().nullable().describe('TODO describe location field for the OpenInspection MCP integration'),
    photos:          z.array(z.string()).describe('TODO describe photos field for the OpenInspection MCP integration'),
});
const myRecommendationsRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/my-recommendations',
    tags: ["agents"],
    summary: 'Defects from referred inspections grouped by category',
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({
                success: z.boolean().describe('TODO describe success field for the OpenInspection MCP integration'),
                data: z.object({
                    safety:         z.array(RecommendationRowSchema).describe('TODO describe safety field for the OpenInspection MCP integration'),
                    recommendation: z.array(RecommendationRowSchema).describe('TODO describe recommendation field for the OpenInspection MCP integration'),
                    maintenance:    z.array(RecommendationRowSchema).describe('TODO describe maintenance field for the OpenInspection MCP integration'),
                }).describe('TODO describe data field for the OpenInspection MCP integration'),
            }) } },
            description: 'Success',
        },
        401: { description: 'Unauthorized' },
        403: { description: 'Forbidden' },
    },
    security: [{ bearerAuth: [] }],
    operationId: "listAgentMyRecommendations",
    description: "Auto-generated placeholder for listAgentMyRecommendations (GET /my-recommendations, agents domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['agent'], tier: 'extended' }));

/**
 * GET /api/agents/leaderboard
 * Admin/owner leaderboard based on referral counts.
 */
const getLeaderboardRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/leaderboard',
    tags: ["agents"],
    summary: "Leaderboard agent for current tenant",
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: LeaderboardResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
            description: 'Success',
        },
        401: { description: 'Unauthorized' },
        403: { description: 'Forbidden' },
    },
    security: [{ bearerAuth: [] }],
    operationId: "leaderboardAgent",
    description: "Auto-generated placeholder for leaderboardAgent (GET /leaderboard, agents domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['agent'], tier: 'extended' }));

/**
 * Agent Accounts A2 — POST /api/agent/profile
 * Persists slug + notification preferences for the signed-in agent. Agents are
 * global users (tenant_id IS NULL), so the route does NOT require a tenantId.
 * RBAC narrows to role='agent' only.
 */
const updateProfileRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/profile',
    tags: ["agents"],
    summary: 'Update agent profile (slug + notification prefs)',
    request: {
        body: { content: { 'application/json': { schema: AgentProfilePatchSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: AgentProfilePatchResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } },
            description: 'Profile updated',
        },
        400: { description: 'Invalid input' },
        401: { description: 'Unauthorized' },
        403: { description: 'Forbidden — agent role required' },
        409: { description: 'Slug already taken' },
    },
    security: [{ bearerAuth: [] }],
    operationId: "createAgentProfile",
    description: "Auto-generated placeholder for createAgentProfile (POST /profile, agents domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['agent'], tier: 'extended' }));

/**
 * Agent Accounts A3 — POST /api/agent/concierge-book
 * Agent submits a booking on behalf of a client. The route never trusts the
 * agent_user_id from the body — it uses `c.get('agentUserId')` set by the
 * global JWT middleware so a stolen tenantId can't bypass the agent ↔ tenant
 * link check.
 */
const conciergeBookRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/concierge-book',
    tags: ["agents"],
    summary: 'Agent submits a concierge booking on behalf of a client',
    request: {
        body: { content: { 'application/json': { schema: ConciergeBookSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: ConciergeBookResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } },
            description: 'Booking created — state machine entered',
        },
        400: { description: 'Invalid input' },
        401: { description: 'Unauthorized' },
        403: { description: 'Forbidden — agent not linked to tenant' },
        404: { description: 'Inspector contact not found' },
    },
    security: [{ bearerAuth: [] }],
    operationId: "createAgentConciergeBook",
    description: "Auto-generated placeholder for createAgentConciergeBook (POST /concierge-book, agents domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['agent'], tier: 'extended' }));

export const agentRoutes = createApiRouter()
    .openapi(getReportsRoute, async (c) => {
        // Move RBAC check inside to fix OpenAPIHono type inference issues with context
        await requireRole(['office_staff', 'admin'])(c, async () => {});

        const tenantId = c.get('tenantId');
        const user = c.get('user');
        const userRole = c.get('userRole');
        const { agentId: queryAgentId } = c.req.valid('query');
        const db = drizzle(c.env.DB);

        // Admins/owners can pass ?agentId= to view any agent's reports
        const agentId =
            userRole === 'admin'
                ? (queryAgentId ?? user.sub)
                : user.sub;

        const rows = await db
            .select()
            .from(inspections)
            .where(and(
                eq(inspections.tenantId, tenantId),
                eq(inspections.referredByAgentId, agentId)
            ));

        return c.json({
            success: true,
            data: { agentId, reports: rows }
        }, 200);
    })
    .openapi(myRecommendationsRoute, async (c) => {
        await requireRole(['agent'])(c, async () => {});
        const user = c.get('user');
        const groups = await c.var.services.agent.listRecommendationsForAgent(user.sub);
        return c.json({ success: true, data: groups }, 200);
    })
    .openapi(getLeaderboardRoute, async (c) => {
        await requireRole(['owner', 'admin', 'inspector', 'agent'])(c, async () => {});

        const tenantId = c.get('tenantId');
        const db = drizzle(c.env.DB);

        // JOIN contacts to surface agent name + agency in one query (Round 28
        // — UI was an orphan; now leaderboard card needs displayable rows).
        const rows = await db
            .select({
                agentId: inspections.referredByAgentId,
                name:    contacts.name,
                agency:  contacts.agency,
                email:   contacts.email,
                total:   sql<number>`count(*)`,
            })
            .from(inspections)
            .leftJoin(contacts, eq(inspections.referredByAgentId, contacts.id))
            .where(eq(inspections.tenantId, tenantId))
            .groupBy(inspections.referredByAgentId, contacts.name, contacts.agency, contacts.email)
            .orderBy(sql`count(*) DESC`);

        // Exclude rows where agentId is null (un-referred inspections)
        const leaderboard = rows.filter((r) => r.agentId !== null);

        return c.json({
            success: true,
            data: { leaderboard }
        }, 200);
    })
    .openapi(updateProfileRoute, async (c) => {
        await requireRole(['agent'])(c, async () => {});
        const user = c.get('user');
        if (!user?.sub) throw Errors.Unauthorized();

        const body = c.req.valid('json');
        const patch: Parameters<typeof c.var.services.agent.updateProfile>[1] = {};
        if (body.slug !== undefined)             patch.slug             = body.slug;
        if (body.name !== undefined)             patch.name             = body.name;
        if (body.notifyOnReferral !== undefined) patch.notifyOnReferral = body.notifyOnReferral;
        if (body.notifyOnReport !== undefined)   patch.notifyOnReport   = body.notifyOnReport;
        if (body.notifyOnPaid !== undefined)     patch.notifyOnPaid     = body.notifyOnPaid;

        await c.var.services.agent.updateProfile(user.sub, patch);
        return c.json({ success: true as const, data: { ok: true as const } }, 200);
    })
    .openapi(conciergeBookRoute, async (c) => {
        await requireRole(['agent'])(c, async () => {});
        const agentUserId = c.get('agentUserId');
        if (!agentUserId) throw Errors.Unauthorized('Agent identity missing from token');

        const body = c.req.valid('json');
        const result = await c.var.services.concierge.createBooking({
            tenantId: body.tenantId,
            agentUserId,
            inspectorContactId: body.inspectorContactId,
            date: body.date,
            timeSlot: body.timeSlot,
            propertyAddress: body.propertyAddress,
            clientName: body.clientName,
            clientEmail: body.clientEmail,
            ...(body.clientPhone ? { clientPhone: body.clientPhone } : {}),
            agreementRequired: body.agreementRequired,
            paymentRequired: body.paymentRequired,
        });
        return c.json({ success: true as const, data: result }, 200);
    });

export type AgentApi = typeof agentRoutes;

export default agentRoutes;
