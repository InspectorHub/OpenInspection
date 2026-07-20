// Plan 1B Task 3 — /api/inspections/:id/people: list/add/remove the people
// (client, co_client, agents, ...) assigned to an inspection via the Plan 1A
// `inspection_people` table + PeopleService. Auth mirrors the sibling
// inspections sub-routers (e.g. ./core.ts): requireRole('owner', 'manager',
// 'inspector') — managing people on an inspection is a normal authenticated
// inspector action, NOT the admin-only role-profile CRUD gate used by
// ../role-profiles.ts (requireRole('owner', 'manager') there).
//
// ⚠️ Known gap in PeopleService.addPerson (Plan 1A Task 5): it validates
// roleProfileId against the tenant internally (throws Errors.NotFound via its
// private `profile()` helper) but does NOT validate contactId at all, and a
// caller-supplied cross-tenant roleProfileId, contactId pair would otherwise
// insert an `inspection_people` row mixing rows from another tenant. The POST
// handler below closes this hole by re-resolving BOTH contactId and
// roleProfileId via a tenant-scoped lookup before ever calling addPerson,
// returning 404 if either isn't owned by the caller's tenant.
import { createRoute, z } from '@hono/zod-openapi';
import { eq, and } from 'drizzle-orm';
import { createApiRouter } from '../../lib/openapi-router';
import { requireRole } from '../../lib/middleware/rbac';
import { getTenantId, getDrizzle } from '../../lib/route-helpers';
import { Errors } from '../../lib/errors';
import { contacts, contactRoleProfiles, inspections } from '../../lib/db/schema';
import { AddPersonSchema } from '../../lib/validations/role-profile.schema';
import { withMcpMetadata } from '../../lib/route-metadata-standards';

const PersonRowSchema = z.object({
    id: z.string().describe('inspection_people row id.'),
    contactId: z.string().describe('The contact assigned to this role.'),
    roleProfileId: z.string().describe('The role profile this contact occupies on the inspection.'),
    roleKey: z.string().describe('Stable machine key of the role profile (e.g. "client", "co_client").'),
    roleLabel: z.string().describe('Tenant-editable display label of the role profile.'),
    kind: z.enum(['client', 'agent', 'other']).describe('Capability class the role derives from.'),
    name: z.string().describe('Contact display name.'),
    email: z.string().nullable().describe('Contact email, if any.'),
    phone: z.string().nullable().describe('Contact phone, if any.'),
    agency: z.string().nullable().describe('Contact agency/company, if any.'),
});

const ParamsId = z.object({ id: z.string().describe('Inspection identifier') });
const ParamsIdPersonId = z.object({
    id: z.string().describe('Inspection identifier'),
    personId: z.string().describe('inspection_people row identifier'),
});

const ErrorResponseSchema = z.object({
    success: z.literal(false),
    error: z.object({ message: z.string(), code: z.string() }),
});

const listPeopleRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/{id}/people',
    tags: ['inspections'],
    summary: 'List people on an inspection',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: { params: ParamsId },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.array(PersonRowSchema) }) } },
            description: 'Every contact/role pairing recorded on the inspection (client, co_client, agents, ...).',
        },
        404: { content: { 'application/json': { schema: ErrorResponseSchema } }, description: 'Inspection not found' },
    },
    operationId: 'listInspectionPeople',
    description: 'Lists every contact assigned to a role on the inspection via inspection_people, tenant-scoped.',
}, { scopes: ['read'], tier: 'extended' }));

const addPersonRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/{id}/people',
    tags: ['inspections'],
    summary: 'Add a person to an inspection',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: ParamsId,
        body: { content: { 'application/json': { schema: AddPersonSchema } } },
    },
    responses: {
        201: { content: { 'application/json': { schema: z.object({ success: z.literal(true) }) } }, description: 'Person added.' },
        404: { content: { 'application/json': { schema: ErrorResponseSchema } }, description: 'Inspection, contact, or role profile not found (including cross-tenant ids).' },
        409: { content: { 'application/json': { schema: ErrorResponseSchema } }, description: 'A primary client is already assigned to this inspection.' },
    },
    operationId: 'addInspectionPerson',
    description: 'Assigns a contact to the inspection under a role profile. Rejects with 409 when roleProfileId is the primary "client" role and one is already assigned to this inspection — co_client and every other role are unrestricted.',
}, { scopes: ['write'], tier: 'extended' }));

const removePersonRoute = createRoute(withMcpMetadata({
    method: 'delete',
    path: '/{id}/people/{personId}',
    tags: ['inspections'],
    summary: 'Remove a person from an inspection',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: { params: ParamsIdPersonId },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.literal(true) }) } }, description: 'Person removed.' },
        404: { content: { 'application/json': { schema: ErrorResponseSchema } }, description: 'Inspection not found' },
    },
    operationId: 'removeInspectionPerson',
    description: 'Removes an inspection_people row, tenant-scoped. A no-op (still 200) if personId does not exist under this tenant.',
}, { scopes: ['write'], tier: 'extended' }));

/**
 * Throws 404 unless `id` names an inspection owned by `tenantId`. Mirrors the
 * tenant-ownership pre-check other inspections sub-routers run before acting
 * on `:id` (e.g. inspections/core.ts's `getInspection` /
 * inspections/cost-export.ts's inline `inspections` lookup) — kept as a
 * direct minimal column-projected query here rather than the heavier
 * `InspectionService.getInspection` (which also loads + parses the full
 * template), since all this handler needs is an existence + ownership check.
 */
async function assertInspectionOwned(db: ReturnType<typeof getDrizzle>, id: string, tenantId: string): Promise<void> {
    const row = await db.select({ id: inspections.id }).from(inspections)
        .where(and(eq(inspections.id, id), eq(inspections.tenantId, tenantId))).get();
    if (!row) throw Errors.NotFound('Inspection not found');
}

const peopleRoutes = createApiRouter()
    .openapi(listPeopleRoute, async (c) => {
        const tenantId = getTenantId(c);
        const { id } = c.req.valid('param');
        await assertInspectionOwned(getDrizzle(c), id, tenantId);
        const data = await c.var.services.people.listPeople(tenantId, id);
        return c.json({ success: true as const, data }, 200);
    })
    .openapi(addPersonRoute, async (c) => {
        const tenantId = getTenantId(c);
        const { id } = c.req.valid('param');
        const { contactId, roleProfileId } = c.req.valid('json');
        const db = getDrizzle(c);
        await assertInspectionOwned(db, id, tenantId);

        // Tenant-ownership pre-check for BOTH ids before ever calling
        // PeopleService.addPerson — see file header for why this can't be
        // skipped (addPerson does not verify contactId at all).
        const contact = await db.select({ id: contacts.id }).from(contacts)
            .where(and(eq(contacts.id, contactId), eq(contacts.tenantId, tenantId))).get();
        if (!contact) throw Errors.NotFound('Contact not found');
        const profile = await db.select({ id: contactRoleProfiles.id }).from(contactRoleProfiles)
            .where(and(eq(contactRoleProfiles.id, roleProfileId), eq(contactRoleProfiles.tenantId, tenantId))).get();
        if (!profile) throw Errors.NotFound('Role profile not found');

        await c.var.services.people.addPerson(tenantId, id, contactId, roleProfileId);
        return c.json({ success: true as const }, 201);
    })
    .openapi(removePersonRoute, async (c) => {
        const tenantId = getTenantId(c);
        const { id, personId } = c.req.valid('param');
        await assertInspectionOwned(getDrizzle(c), id, tenantId);
        await c.var.services.people.removePerson(tenantId, personId);
        return c.json({ success: true as const }, 200);
    });

export default peopleRoutes;
