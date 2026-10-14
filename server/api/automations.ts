import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { requireRole } from '../lib/middleware/rbac';
import {
    AutomationListResponseSchema, AutomationLogListResponseSchema,
    CreateAutomationSchema, UpdateAutomationSchema, AutomationSchema,
} from '../lib/validations/automation.schema';
import { createApiResponseSchema, SuccessResponseSchema } from '../lib/validations/shared.schema';
import { withMcpMetadata } from "../lib/route-metadata-standards";

// GET /api/automations
const listRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/', tags: ["automations"],
    middleware: [requireRole('owner', 'manager')],
    responses: { 200: { content: { 'application/json': { schema: AutomationListResponseSchema } }, description: 'List' } },
    operationId: "listAutomations",
    summary: "List automations for current tenant",
    description: "Lists all of the company's messaging automation rules, defaults included, with each rule's trigger, recipients, channels, delay and active flag. Not paginated or filtered. Side effect: before listing, any built-in default rules missing from the company are created (and the platform SMS disclosure record is created if none exists), so the first call on a new company writes rows. Restricted to owners and managers."
}, { scopes: ['read'], tier: 'extended' }));

// POST /api/automations
const createAutomationRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/', tags: ["automations"],
    middleware: [requireRole('owner', 'manager')],
    request: { body: { content: { 'application/json': { schema: CreateAutomationSchema.describe('The new rule: its trigger, recipients, delay, channels and templates') } } } },
    responses: { 201: { content: { 'application/json': { schema: createApiResponseSchema(AutomationSchema) } }, description: 'Created' } },
    operationId: "createAutomation",
    summary: "Create automation for current tenant",
    description: "Create a messaging automation rule that sends an email, SMS or in-app notice when a trigger event "
        + "happens, after an optional delay in minutes. The rule is created active and is never a default rule. "
        + "Channels default to email, and the delay defaults to 0. A rule aimed at a role must name the role "
        + "profile in recipientRoleProfileId, and any other recipient kind must leave it out. The message wording "
        + "comes from the referenced message templates, not from the rule. Not idempotent: each call creates "
        + "another rule. Restricted to owners and managers."
}, { scopes: ['write'], tier: 'extended' }));

// GET /api/automations/logs/recent — Spec 3C, tenant-wide activity feed
// MUST be registered BEFORE /logs/{inspectionId} to avoid path-param shadowing
const getRecentLogsRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/logs/recent', tags: ["automations"],
    middleware: [requireRole('owner', 'manager')],
    request: { query: z.object({ limit: z.coerce.number().int().min(1).max(200).optional().describe('Maximum number of log entries to return, 1-200. Defaults to 50') }) },
    responses: { 200: { content: { 'application/json': { schema: AutomationLogListResponseSchema } }, description: 'Recent automation logs' } },
    operationId: "listAutomationLogsRecent",
    summary: "List automation logs recent",
    description: "Returns the company-wide activity log of automation sends, newest scheduled send first (by sendAt), up to limit entries (default 50, no paging). Each entry is a raw log row for one send attempt, across all automation rules. Read-only. Restricted to owners and managers."
}, { scopes: ['read'], tier: 'extended' }));

// The per-inspection logs route (`GET /logs/{inspectionId}`) is RETIRED: it
// never had a caller, and its query now serves the richer
// `GET /api/inspections/:id/communication` payload. Two endpoints over one
// query is how they drift. `/logs/recent` stays — Settings → Automations
// renders it.

// PATCH /api/automations/:id
const updateRoute = createRoute(withMcpMetadata({
    method: 'patch', path: '/{id}', tags: ["automations"],
    middleware: [requireRole('owner', 'manager')],
    request: {
        params: z.object({ id: z.string().describe('Id of the automation rule to change; must belong to this company') }),
        body: { content: { 'application/json': { schema: UpdateAutomationSchema.describe('The rule fields to change; omitted fields are left as they are') } } },
    },
    responses: { 200: { content: { 'application/json': { schema: createApiResponseSchema(AutomationSchema) } }, description: 'Updated' } },
    operationId: "patchAutomation",
    summary: "Patch automation for current tenant",
    description: "Change an automation rule. Only the fields sent are written. Sending conditions as null removes all "
        + "send-time gates, and channels, if sent, replaces the whole channel list. This is also how a rule is "
        + "switched off or on (active). Default rules can be edited. Unlike create, an update does not re-check "
        + "that recipientRoleProfileId matches recipientKind, so send them together. Returns 404 when the id is "
        + "not a rule in this company. Idempotent. Restricted to owners and managers."
}, { scopes: ['write'], tier: 'extended' }));

// DELETE /api/automations/:id
const deleteRoute = createRoute(withMcpMetadata({
    method: 'delete', path: '/{id}', tags: ["automations"],
    middleware: [requireRole('owner', 'manager')],
    request: { params: z.object({ id: z.string().describe('Id of the automation rule to delete; must belong to this company') }) },
    responses: { 200: { content: { 'application/json': { schema: SuccessResponseSchema } }, description: 'Deleted' } },
    operationId: "deleteAutomation",
    summary: "Delete automation for current tenant",
    description: "Permanently delete an automation rule. Default rules cannot be deleted (403); switch them off with "
        + "an update instead. Returns 404 when the id is not a rule in this company, so repeating the call fails "
        + "the second time. Restricted to owners and managers."
}, { scopes: ['write'], tier: 'extended' }));

const automationsRoutes = createApiRouter()
    .openapi(listRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        await c.var.services.automation.ensureSeeds(tenantId);
        const rows = await c.var.services.automation.list(tenantId);
        return c.json({ success: true, data: rows });
    })
    .openapi(createAutomationRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const data = c.req.valid('json');
        const row = await c.var.services.automation.create(tenantId, data);
        return c.json({ success: true, data: row }, 201);
    })
    .openapi(getRecentLogsRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const { limit } = c.req.valid('query');
        const rows = await c.var.services.automation.listRecentLogs(tenantId, limit ?? 50);
        return c.json({ success: true, data: rows });
    })
    .openapi(updateRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const { id } = c.req.valid('param');
        const data = c.req.valid('json');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Zod partial() adds undefined to values, incompatible with exactOptionalPropertyTypes
        const row = await c.var.services.automation.update(tenantId, id, data as any);
        return c.json({ success: true, data: row });
    })
    .openapi(deleteRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const { id } = c.req.valid('param');
        await c.var.services.automation.delete(tenantId, id);
        return c.json({ success: true });
    });

export type AutomationsApi = typeof automationsRoutes;

export default automationsRoutes;
