import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { requireRole } from '../../lib/middleware/rbac';
import { withMcpMetadata } from '../../lib/route-metadata-standards';
import { getDrizzle } from '../../lib/route-helpers';
import { buildScreenModel } from '../../lib/notifications/screen-model';
import { assertChoosable, readChoices, writeChoice } from '../../lib/notifications/preference-write';
import { listAgentCompanies } from '../../services/agent/companies';
import { Errors } from '../../lib/errors';

/**
 * A partner agent's notification preferences — PER COMPANY (spec §4).
 *
 * An agent account is global (`users.tenant_id IS NULL`) and its JWT carries no
 * tenant, so this cannot be the staff route with a different role check: there
 * is no tenant in the session to scope a preference to. What the agent has
 * instead is one `contacts` row per company that works with them, and that row
 * is the subject a preference is keyed on.
 *
 * Per company, not global, because the relationships are genuinely separate: an
 * agent who refers weekly to one firm and twice a year to another has a real
 * reason to want different mail from each. The cost of that choice is that a
 * company linked LATER starts at the defaults — which is why the screen lists
 * the companies rather than hiding them behind one switch, and why `scope:
 * 'all'` exists for the common case where the agent means "everyone".
 *
 * SUBJECT COMES FROM THE SESSION. The body names a COMPANY, never a subject:
 * the contact id is looked up from the agent's own bindings, so naming another
 * company is at worst a 400 and never a way to write someone else's row.
 */

const ChannelSchema = z.enum(['email', 'sms', 'in_app']);

const CompanySchema = z.object({
    id: z.string().describe('Tenant id of the inspection company.'),
    name: z.string().describe('Company name as the agent knows it.'),
});

const ScreenResponseSchema = z.object({
    success: z.literal(true),
    data: z.object({
        companies: z.array(CompanySchema),
        selected: z.string().nullable().describe('Which company the returned rows describe.'),
        alwaysSent: z.array(z.object({
            id: z.string(), label: z.string(), channels: z.array(z.string()),
        })),
        youChoose: z.array(z.object({
            id: z.string(),
            label: z.string(),
            channels: z.object({ email: z.string(), sms: z.string(), in_app: z.string() }),
        })),
    }),
}).openapi('AgentNotificationPreferencesScreen');

const SaveSchema = z.object({
    classId: z.string().describe('The notification class being changed, e.g. agent-new-referral.'),
    channel: ChannelSchema.describe('Which channel this choice applies to.'),
    enabled: z.boolean().describe('True to receive it; false to switch it off.'),
    companyId: z.string().optional().describe('Tenant id to apply this to. Required unless scope is "all".'),
    scope: z.enum(['company', 'all']).optional()
        .describe('"all" applies the choice to every company currently linked to this agent.'),
});

const getScreenRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/notification-preferences',
    tags: ['agents'],
    summary: 'What each company sends this agent, and what they can switch off',
    request: {
        query: z.object({
            companyId: z.string().optional().describe('Which company to read. Defaults to the first.'),
        }),
    },
    responses: {
        200: {
            content: { 'application/json': { schema: ScreenResponseSchema } },
            description: 'The agent\'s companies plus the two sections for the selected one.',
        },
        401: { description: 'Unauthorized' },
    },
    security: [{ bearerAuth: [] }],
    operationId: 'getAgentNotificationPreferences',
    description:
        'Lists the companies this agent is currently bound to and returns the notification ' +
        'screen for one of them. Channels a class never uses are reported as "unavailable", ' +
        'which is not the same as "off".',
}, { scopes: ['agent'], tier: 'extended' }));

const saveRoute = createRoute(withMcpMetadata({
    method: 'put',
    path: '/notification-preferences',
    tags: ['agents'],
    summary: 'Switch a notification on or off at one company',
    request: { body: { content: { 'application/json': { schema: SaveSchema } } } },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true), applied: z.number() }) } },
            description: 'Saved. `applied` counts the companies it was written for.',
        },
        400: { description: 'Unknown class, a class that is always sent, or a company this agent is not bound to' },
        401: { description: 'Unauthorized' },
    },
    security: [{ bearerAuth: [] }],
    operationId: 'saveAgentNotificationPreference',
    description:
        'Records one explicit choice against the agent\'s contact row at one company, or at ' +
        'every company currently linked to them when scope is "all". A choice that matches the ' +
        'class default deletes the row rather than storing it.',
}, { scopes: ['agent'], tier: 'extended' }));

const agentNotificationPreferenceRoutes = createApiRouter()
    .openapi(getScreenRoute, async (c) => {
        await requireRole('agent')(c, async () => {});
        const agentUserId = c.get('user').sub;
        const db = getDrizzle(c);

        const companies = await listAgentCompanies(db, agentUserId);
        const { companyId } = c.req.valid('query');
        const selected = companyId
            ? companies.find((x) => x.tenantId === companyId)
            : companies[0];
        // An unknown id is not an error here: the agent may have been revoked
        // since the page loaded, and a 400 on a READ would strand them on a
        // screen with nothing to do. Fall back to showing the company list.
        const chosen = selected
            ? await readChoices(db, selected.tenantId, 'contact', selected.contactId)
            : new Map<string, boolean>();

        return c.json({
            success: true as const,
            data: {
                companies: companies.map((x) => ({ id: x.tenantId, name: x.name })),
                selected: selected?.tenantId ?? null,
                ...buildScreenModel('agent', chosen),
            },
        }, 200);
    })
    .openapi(saveRoute, async (c) => {
        await requireRole('agent')(c, async () => {});
        const agentUserId = c.get('user').sub;
        const { classId, channel, enabled, companyId, scope } = c.req.valid('json');

        // Refused at the edge as well as at the send boundary — the boundary is
        // what makes a preference true, this is what keeps the screen honest.
        assertChoosable(classId, channel, 'agent');

        const db = getDrizzle(c);
        const companies = await listAgentCompanies(db, agentUserId);
        const targets = scope === 'all'
            ? companies
            : companies.filter((x) => x.tenantId === companyId);
        if (targets.length === 0) {
            throw Errors.BadRequest('You are not currently linked to that company.');
        }

        for (const t of targets) {
            await writeChoice(db, {
                tenantId: t.tenantId, subjectKind: 'contact', subjectId: t.contactId,
                classId, channel, enabled,
            });
        }
        return c.json({ success: true as const, applied: targets.length }, 200);
    });

export default agentNotificationPreferenceRoutes;
export type AgentNotificationPreferencesApi = typeof agentNotificationPreferenceRoutes;
