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
import { isSoleClient } from '../../lib/people/primary-client';
import { reportLinkExpiresAt, REPORT_LINK_TTL_MAX_COUNT } from '../../lib/report-link-ttl';
import { auditFromContext } from '../../lib/audit';
import type { PersonRow as PersonServiceRow } from '../../services/people.service';
import type { PortalLinkState } from '../../lib/portal-link-state';

/**
 * What PortalAccessService.listAccessForInspection returns. Annotated locally
 * because the DI container's service types sit in an import cycle with the Hono
 * config, so `c.var.services` widens to `any` inside route modules — an
 * annotation here keeps the join below actually type-checked.
 */
interface PortalAccessRowView {
    recipientEmail: string;
    sentAt: number;
    expiresAt: number | null;
    status: Exclude<PortalLinkState, 'unknown'>;
}

/**
 * IA-36 ⑪ — the report link's state for this person. The card lists people and
 * offers link actions on each row; without state the operator is choosing "reset
 * this link" with no idea whether the current one was ever sent, is live, or was
 * already taken away. `not_sent` is an explicit value, not an absent field.
 */
const PersonAccessSchema = z.object({
    status: z.enum(['not_sent', 'active', 'expired', 'revoked']).describe('State of this recipient\'s report link.'),
    sentAt: z.number().nullable().describe('Epoch ms the current link was minted, or null when none was ever issued.'),
    expiresAt: z.number().nullable().describe('Epoch ms the link stops working, or null for an open-ended link.'),
});

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
    access: PersonAccessSchema,
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
        409: { content: { 'application/json': { schema: ErrorResponseSchema } }, description: 'The company has no co-client role to move a displaced primary client into.' },
    },
    operationId: 'addInspectionPerson',
    description: 'Assigns a contact to the inspection under a role profile. Adding a second person under the primary "client" role HANDS THE SEAT OVER (IA-36 ⑬): the newcomer becomes the primary client and the incumbent stays on the inspection as co-client, with their report access untouched. "Exactly one primary client" is upheld by that swap rather than by refusing the add.',
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
    description: 'Removes an inspection_people row, tenant-scoped, and revokes that person\'s report link. A no-op (still 200) if personId does not exist under this tenant. Refuses with 409 when they are the only client-side person on the inspection.',
}, { scopes: ['write'], tier: 'extended' }));

const resetAccessRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/{id}/people/{personId}/reset-access',
    tags: ['inspections'],
    summary: 'Reset a person\'s report access link',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: { params: ParamsIdPersonId },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.literal(true) }) } }, description: 'The link was rotated; the previous URL no longer works.' },
        400: { content: { 'application/json': { schema: ErrorResponseSchema } }, description: 'That person has no email address, so they have no link.' },
        404: { content: { 'application/json': { schema: ErrorResponseSchema } }, description: 'Inspection/person not found, or that recipient never had a link.' },
    },
    operationId: 'resetInspectionPersonAccess',
    description: 'Rotates the persistent report-access token for one recipient IN PLACE (a second row for the same (inspection, recipient) pair is forbidden by a unique index). The old URL dies immediately; the new one is delivered by re-sending the report. Use when a link reached the wrong person. Writes a portal_access.rotated audit event referencing the previous token by hash.',
}, { scopes: ['write'], tier: 'extended' }));

const makePrimaryRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/{id}/people/{personId}/make-primary',
    tags: ['inspections'],
    summary: 'Move the primary-client seat to this person',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: { params: ParamsIdPersonId },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.literal(true) }) } }, description: 'The seat moved.' },
        400: { content: { 'application/json': { schema: ErrorResponseSchema } }, description: 'That person is not a client-type role.' },
        404: { content: { 'application/json': { schema: ErrorResponseSchema } }, description: 'Inspection or person not found.' },
        409: { content: { 'application/json': { schema: ErrorResponseSchema } }, description: 'The company has no co-client role to move the incumbent into.' },
    },
    operationId: 'makeInspectionPersonPrimary',
    description: 'Atomically swaps the primary-client role onto this person; the previous primary client becomes a co-client and stays on the inspection with their access intact. "Exactly one primary client" is upheld by this swap rather than by refusing a second add.',
}, { scopes: ['write'], tier: 'extended' }));

const ReportLinkTtlSchema = z.union([
    z.literal('never'),
    z.object({
        count: z.number().int().min(1).max(REPORT_LINK_TTL_MAX_COUNT).describe('How many units from now the links stop working.'),
        unit: z.enum(['days', 'months', 'years']).describe('Unit the count is expressed in: days, months or years.'),
    }),
]).describe('A DURATION from now, or "never". Deliberately not an absolute date — only an absolute date can be set in the past.');

const reportLinkExpiryRoute = createRoute(withMcpMetadata({
    method: 'put',
    path: '/{id}/report-link-expiry',
    tags: ['inspections'],
    summary: 'Set when this inspection\'s report links stop working',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: ParamsId,
        body: { content: { 'application/json': { schema: z.object({ ttl: ReportLinkTtlSchema }) } } },
    },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.object({ expiresAt: z.number().nullable() }) }) } }, description: 'The resulting absolute expiry, or null for open-ended.' },
        404: { content: { 'application/json': { schema: ErrorResponseSchema } }, description: 'Inspection not found' },
    },
    operationId: 'setInspectionReportLinkExpiry',
    description: 'Applies an expiry to every report link already issued for THIS inspection, expressed as a duration from now. The tenant-wide reportLinkTtl policy only ever affects links minted after it changes; this endpoint is the explicit, per-inspection way to act on links that already exist.',
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

/**
 * Resolve one person on the inspection, 404ing when they are not on it. Shared
 * by the two per-person link verbs so neither can act on a personId that
 * belongs to a different inspection.
 */
async function personOnInspection(
    c: Parameters<typeof getTenantId>[0], tenantId: string, inspectionId: string, personId: string,
) {
    const people: PersonServiceRow[] = await c.var.services.people.listPeople(tenantId, inspectionId);
    const person = people.find((p) => p.id === personId);
    if (!person) throw Errors.NotFound('Person not found on this inspection');
    return { person, people };
}

const NO_ACCESS = { status: 'not_sent' as const, sentAt: null, expiresAt: null };

const peopleRoutes = createApiRouter()
    .openapi(listPeopleRoute, async (c) => {
        const tenantId = getTenantId(c);
        const { id } = c.req.valid('param');
        await assertInspectionOwned(getDrizzle(c), id, tenantId);
        const people: PersonServiceRow[] = await c.var.services.people.listPeople(tenantId, id);
        // IA-36 ⑪ — join the report-link state on by recipient email. Kept in
        // the handler (not PeopleService) so the people service stays free of
        // the portal-access dependency, same seam as the remove→revoke cascade.
        const access: PortalAccessRowView[] = await c.var.services.portalAccess.listAccessForInspection(tenantId, id);
        const byEmail = new Map(access.map((a) => [a.recipientEmail, a]));
        const data = people.map((p) => {
            const a = p.email ? byEmail.get(p.email) : undefined;
            return {
                ...p,
                access: a ? { status: a.status, sentAt: a.sentAt, expiresAt: a.expiresAt } : NO_ACCESS,
            };
        });
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
        // IA-36 ⑬ — the primary client IS removable; what is not allowed is
        // leaving the inspection with nobody on the client side. Say so, rather
        // than hiding the control and letting the operator guess why.
        const people: PersonServiceRow[] = await c.var.services.people.listPeople(tenantId, id);
        if (isSoleClient(people, personId)) {
            throw Errors.Conflict('This is the only client on the inspection. Add another client or make someone else primary first.');
        }
        const { email } = await c.var.services.people.removePerson(tenantId, id, personId);
        // IA-36 ① — leaving the inspection stops the person's report link. Their
        // access token is revoked (revokedAt beats any expiry, so the link is
        // dead regardless of the report-link TTL).
        if (email) {
            const { previousTokenHash } = await c.var.services.portalAccess.revokeForRecipient(tenantId, id, email) ?? {};
            // ④ — the only durable trace of "which link stopped working, when,
            // and on whose action". Hash only: the plaintext never leaves the
            // sealed column, least of all into a log the whole company can read.
            auditFromContext(c, 'portal_access.revoked', 'inspection', {
                entityId: id,
                metadata: { recipientEmail: email, previousTokenHash: previousTokenHash ?? null, reason: 'removed_from_inspection' },
            });
        }
        return c.json({ success: true as const }, 200);
    })
    .openapi(resetAccessRoute, async (c) => {
        const tenantId = getTenantId(c);
        const { id, personId } = c.req.valid('param');
        await assertInspectionOwned(getDrizzle(c), id, tenantId);
        const { person } = await personOnInspection(c, tenantId, id, personId);
        if (!person.email) throw Errors.BadRequest('This person has no email address, so they have no report link.');
        const rotated = await c.var.services.portalAccess.rotateForRecipient(tenantId, id, person.email);
        if (!rotated) throw Errors.NotFound('No report link has been issued to this person yet.');
        auditFromContext(c, 'portal_access.rotated', 'inspection', {
            entityId: id,
            metadata: { recipientEmail: person.email, previousTokenHash: rotated.previousTokenHash },
        });
        // The new token is NOT returned. It reaches the recipient the same way
        // the first one did — by sending the report — so a rotated link never
        // sits in a browser history or a support-chat paste.
        return c.json({ success: true as const }, 200);
    })
    .openapi(makePrimaryRoute, async (c) => {
        const tenantId = getTenantId(c);
        const { id, personId } = c.req.valid('param');
        await assertInspectionOwned(getDrizzle(c), id, tenantId);
        await c.var.services.people.makePrimary(tenantId, id, personId);
        return c.json({ success: true as const }, 200);
    })
    .openapi(reportLinkExpiryRoute, async (c) => {
        const tenantId = getTenantId(c);
        const { id } = c.req.valid('param');
        const { ttl } = c.req.valid('json');
        await assertInspectionOwned(getDrizzle(c), id, tenantId);
        const expiresAt = reportLinkExpiresAt(ttl, Date.now());
        await c.var.services.portalAccess.setExpiryForInspection(tenantId, id, expiresAt);
        return c.json({ success: true as const, data: { expiresAt } }, 200);
    });

export default peopleRoutes;
