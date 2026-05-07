import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { drizzle } from 'drizzle-orm/d1';
import { and, eq, sql } from 'drizzle-orm';
import { requireRole } from '../lib/middleware/rbac';
import { inspections } from '../lib/db/schema/inspection';
import { contacts } from '../lib/db/schema/contact';
import { HonoConfig } from '../types/hono';
import { 
    AgentReportsQuerySchema, 
    AgentReportsResponseSchema, 
    LeaderboardResponseSchema 
} from '../lib/validations/agent.schema';

const agentRoutes = new OpenAPIHono<HonoConfig>();

/**
 * GET /api/agents/my-reports
 * Agent or admin can view referral reports.
 */
const getReportsRoute = createRoute({
    method: 'get',
    path: '/my-reports',
    tags: ['Agents'],
    summary: 'View referral reports',
    request: {
        query: AgentReportsQuerySchema,
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: AgentReportsResponseSchema,
                },
            },
            description: 'Success',
        },
        401: { description: 'Unauthorized' },
        403: { description: 'Forbidden' },
    },
    security: [{ bearerAuth: [] }],
});

agentRoutes.openapi(getReportsRoute, async (c) => {
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
});

/**
 * GET /api/agents/leaderboard
 * Admin/owner leaderboard based on referral counts.
 */
const getLeaderboardRoute = createRoute({
    method: 'get',
    path: '/leaderboard',
    tags: ['Agents'],
    summary: 'Agent referral leaderboard',
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: LeaderboardResponseSchema,
                },
            },
            description: 'Success',
        },
        401: { description: 'Unauthorized' },
        403: { description: 'Forbidden' },
    },
    security: [{ bearerAuth: [] }],
});

agentRoutes.openapi(getLeaderboardRoute, async (c) => {
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
});

export default agentRoutes;
