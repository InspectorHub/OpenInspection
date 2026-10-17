import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { requireRole } from '../lib/middleware/rbac';
import { capabilitiesFor } from '../lib/middleware/require-capability';
import { auditFromContext } from '../lib/audit';
import { withMcpMetadata } from '../lib/route-metadata-standards';
import { Errors } from '../lib/errors';
import { auditRefusedGrant } from './team-grant-audit';
import { PermissionTemplateService } from '../services/team/permission-templates.service';
import {
    MAX_COMPANY_TEMPLATES, SYSTEM_TEMPLATES, findSystemTemplate, resolveTemplate,
    type CompanyTemplate,
} from '../lib/auth/permission-templates';
import {
    PermissionTemplateInputSchema,
    PermissionTemplateListResponseSchema,
    PermissionTemplateResponseSchema,
} from '../lib/validations/team-template.schema';
import type { HonoConfig } from '../types/hono';
import type { Context } from 'hono';

/**
 * `/api/team/permission-templates` — built-in and company-defined permission
 * templates. Split out of `team.ts` for the same reason `team-defaults.ts` is:
 * that file is at its size ceiling and this is a self-contained family. Mounted
 * back at `/` so the public path is under `/api/team`.
 *
 * Applying a template is not a route here. It is the optional `templateId` on
 * `POST /api/team/invite` and `PATCH /api/team/members/{id}`, which copies the
 * template's role and switches onto the invite or the member and runs the same
 * grant ceiling as any other grant.
 *
 * The routes are named consts, not inlined into the chain: the retry-safety
 * ledger resolves `.openapi(IDENT)` and cannot see a route written inline.
 */

const idParam = z.object({
    id: z.string().trim().min(1).describe('The id of a company template, as listed by GET /api/team/permission-templates.'),
});

function toListEntry(t: CompanyTemplate) {
    return { id: t.id, system: false as const, name: t.name, description: null, baseRole: t.baseRole, overrides: t.overrides ?? {} };
}

async function actorOf(c: Context<HonoConfig>) {
    return { role: c.get('userRole'), capabilities: await capabilitiesFor(c), userId: c.get('user')?.sub as string | undefined };
}

function refuseBuiltIn(id: string): void {
    if (findSystemTemplate(id)) {
        throw Errors.BadRequest('Built-in permission templates cannot be changed or archived. Create a template of your own with the switches you want instead.');
    }
}

const listTemplatesRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/permission-templates',
    tags: ['team'],
    summary: 'List built-in and company permission templates',
    middleware: [requireRole('owner', 'manager')] as const,
    responses: {
        200: { content: { 'application/json': { schema: PermissionTemplateListResponseSchema } }, description: 'Built-in and company templates' },
    },
    operationId: 'listPermissionTemplates',
    description: 'Lists the permission templates a person can start from when inviting a team member or editing one: the built-in templates (system true, fixed) followed by the company\'s own live templates, oldest first. Each has a base role and the capability switches that differ from that role\'s defaults, exactly as they are copied onto an invite or a member. Also returns how many company templates one company may keep. Read-only. Restricted to owners and managers.',
}, { scopes: ['admin'], tier: 'extended' }));

const createTemplateRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/permission-templates',
    tags: ['team'],
    summary: 'Create a company permission template',
    middleware: [requireRole('owner', 'manager')] as const,
    request: { body: { content: { 'application/json': { schema: PermissionTemplateInputSchema } } } },
    responses: {
        201: { content: { 'application/json': { schema: PermissionTemplateResponseSchema } }, description: 'Template created' },
        400: { description: 'The base role is not manager, inspector or staff, or the name is empty or too long' },
        403: { description: 'A manager asked for a switch (or a role carrying it) that the manager does not hold' },
        409: { description: 'The name is taken by another live template, or the company is at its template limit' },
    },
    operationId: 'createPermissionTemplate',
    description: 'Saves a company permission template: a name, a base role (manager, inspector or staff) and the capability switches that differ from that role\'s defaults. Applying it later copies its role and switches onto an invite or a member; changing or archiving it afterwards does not change anyone who already received it. A manager cannot save a template that turns on a switch the manager does not hold themselves, including through the base role; an owner can. The name must be unique among live templates, and a company keeps at most 25. Writes a permission_template.create audit entry. Restricted to owners and managers.',
}, { scopes: ['admin'], tier: 'extended' }));

const updateTemplateRoute = createRoute(withMcpMetadata({
    method: 'put',
    path: '/permission-templates/{id}',
    tags: ['team'],
    summary: 'Change a company permission template',
    middleware: [requireRole('owner', 'manager')] as const,
    request: { params: idParam, body: { content: { 'application/json': { schema: PermissionTemplateInputSchema } } } },
    responses: {
        200: { content: { 'application/json': { schema: PermissionTemplateResponseSchema } }, description: 'Template updated' },
        400: { description: 'A built-in template was named, or the input is not valid' },
        403: { description: 'A manager asked for a switch (or a role carrying it) that the manager does not hold' },
        404: { description: 'No live template with this id in this company' },
        409: { description: 'The name is taken by another live template' },
    },
    operationId: 'updatePermissionTemplate',
    description: 'Replaces a company template\'s name, base role and switches. People who already received the template keep what was copied onto them; only future applications see the change. Built-in templates cannot be changed (400). The same ceiling as on creation applies: a manager cannot widen a template past the manager\'s own permissions. Writes a permission_template.update audit entry. Restricted to owners and managers.',
}, { scopes: ['admin'], tier: 'extended' }));

const archiveTemplateRoute = createRoute(withMcpMetadata({
    method: 'delete',
    path: '/permission-templates/{id}',
    tags: ['team'],
    summary: 'Archive a company permission template',
    middleware: [requireRole('owner', 'manager')] as const,
    request: { params: idParam },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.boolean(), data: z.object({ archived: z.boolean() }) }) } }, description: 'Template archived' },
        400: { description: 'A built-in template was named' },
        404: { description: 'No live template with this id in this company' },
    },
    operationId: 'archivePermissionTemplate',
    description: 'Archives a company template so it can no longer be applied and its name can be used again. Nothing is deleted and nobody who received the template is changed. Built-in templates cannot be archived (400). Writes a permission_template.archive audit entry. Restricted to owners and managers.',
}, { scopes: ['admin'], tier: 'extended' }));

const teamPermissionTemplateRoutes = createApiRouter()
    .openapi(listTemplatesRoute, async (c) => {
        const company = await new PermissionTemplateService(c.env.DB).list(c.get('tenantId'));
        const builtIn = SYSTEM_TEMPLATES.map((t) => ({
            id: t.key, system: true as const, name: t.name, description: t.description, baseRole: t.baseRole,
            overrides: resolveTemplate(t.key).permissionOverrides ?? {},
        }));
        return c.json({
            success: true as const,
            data: { templates: [...builtIn, ...company.map(toListEntry)], maxCompanyTemplates: MAX_COMPANY_TEMPLATES },
        }, 200);
    })
    .openapi(createTemplateRoute, async (c) => {
        const body = c.req.valid('json');
        const actor = await actorOf(c);
        const created = await auditRefusedGrant(c, 'template', body.baseRole, () =>
            new PermissionTemplateService(c.env.DB).create(c.get('tenantId'), actor, body, actor.userId ?? null));
        auditFromContext(c, 'permission_template.create', 'permission_template', {
            entityId: created.id, metadata: { name: created.name, baseRole: created.baseRole },
        });
        return c.json({ success: true as const, data: toListEntry(created) }, 201);
    })
    .openapi(updateTemplateRoute, async (c) => {
        const { id } = c.req.valid('param');
        const body = c.req.valid('json');
        refuseBuiltIn(id);
        const actor = await actorOf(c);
        const updated = await auditRefusedGrant(c, 'template', body.baseRole, () =>
            new PermissionTemplateService(c.env.DB).update(c.get('tenantId'), actor, id, body));
        auditFromContext(c, 'permission_template.update', 'permission_template', {
            entityId: id, metadata: { name: updated.name, baseRole: updated.baseRole },
        });
        return c.json({ success: true as const, data: toListEntry(updated) }, 200);
    })
    .openapi(archiveTemplateRoute, async (c) => {
        const { id } = c.req.valid('param');
        refuseBuiltIn(id);
        const archived = await new PermissionTemplateService(c.env.DB).archive(c.get('tenantId'), id);
        auditFromContext(c, 'permission_template.archive', 'permission_template', {
            entityId: id, metadata: { name: archived.name, baseRole: archived.baseRole },
        });
        return c.json({ success: true as const, data: { archived: true as const } }, 200);
    });

export default teamPermissionTemplateRoutes;
