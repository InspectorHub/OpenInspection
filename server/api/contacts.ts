import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import type { ContactType } from '../lib/db/schema/contact';
import { requireRole } from '../lib/middleware/rbac';
import { requireCapability } from '../lib/middleware/require-capability';
import { createApiResponseSchema } from '../lib/validations/shared.schema';
import {
    CreateContactSchema, UpdateContactSchema,
    ContactResponseSchema, ContactListQuerySchema,
    ContactDetailResponseSchema,
} from '../lib/validations/contact.schema';
import { withMcpMetadata } from "../lib/route-metadata-standards";

/**
 * `contacts.id` is a TEXT column holding an opaque identifier. Every writer
 * happens to mint `crypto.randomUUID()` today, but the COLUMN does not promise
 * that and the API must not either: pinning the param to `.uuid()` rejects a
 * perfectly valid id at the edge, and does so with a 400 that reads like bad
 * input rather than an unsupported id format. Same defect as the `inspectorId`
 * `.uuid()` that rejected an entire patch against a text column (IA-87).
 *
 * It also has to be ONE rule. This resource previously validated `.min(1)` on
 * GET and `.uuid()` on update/delete/access, so the same id could be readable
 * and un-revokable — and the access panel rendered that 400 as "this contact
 * cannot open any reports".
 */
const CONTACT_ID = z.string().trim().min(1);

const listContactsRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/',
    tags: ["contacts"], summary: "List contacts for current tenant",
    middleware: [requireRole('owner', 'manager', 'inspector')],
    request: { query: ContactListQuerySchema.describe('TODO describe query field for the OpenInspection MCP integration') },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'), data: z.array(ContactResponseSchema).describe('TODO describe data field for the OpenInspection MCP integration'), meta: z.object({ total: z.number().describe('TODO describe total field for the OpenInspection MCP integration') }).describe('TODO describe meta field for the OpenInspection MCP integration') }) } },
            description: 'Success',
        },
    },
    security: [{ bearerAuth: [] }],
    operationId: "listContacts",
    description: "Auto-generated placeholder for listContacts (GET /, contacts domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'primary' }));

const getContactDetailRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/{id}',
    tags: ["contacts"], summary: "Contact detail: record + inspection history + stats",
    middleware: [requireRole('owner', 'manager', 'inspector')],
    request: { params: z.object({ id: CONTACT_ID.describe('Contact id.') }) },
    responses: {
        200: {
            content: { 'application/json': { schema: ContactDetailResponseSchema } },
            description: 'Contact detail payload',
        },
        404: { description: 'Contact not found in this tenant' },
    },
    security: [{ bearerAuth: [] }],
    operationId: "getContactDetail",
    description: "Returns the contact record, its inspection history (newest first; clients match via clientContactId or legacy clientEmail, agents via referredByAgentId or sellingAgentId), and aggregate stats (inspection count + total paid-invoice revenue in cents)."
}, { scopes: ['read'], tier: 'primary' }));

const createContactRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/',
    tags: ["contacts"], summary: "Create contact for current tenant",
    // Task 10 — manageContacts capability gates contact CREATE/UPDATE/DELETE.
    middleware: [requireRole('owner', 'manager', 'inspector'), requireCapability('manageContacts')],
    request: { body: { content: { 'application/json': { schema: CreateContactSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } } },
    responses: {
        201: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'), data: z.object({ contact: ContactResponseSchema.describe('TODO describe contact field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration') }) } },
            description: 'Created',
        },
    },
    security: [{ bearerAuth: [] }],
    operationId: "createContact",
    description: "Auto-generated placeholder for createContact (POST /, contacts domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'primary', capability: 'manageContacts' }));

const updateContactRoute = createRoute(withMcpMetadata({
    method: 'put', path: '/{id}',
    tags: ["contacts"], summary: "Replace contact for current tenant",
    // Task 10 — manageContacts capability gates contact CREATE/UPDATE/DELETE.
    middleware: [requireRole('owner', 'manager', 'inspector'), requireCapability('manageContacts')],
    request: {
        params: z.object({ id: CONTACT_ID.describe('Contact id.') }),
        body: { content: { 'application/json': { schema: UpdateContactSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'), data: z.object({ contact: ContactResponseSchema.describe('TODO describe contact field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration') }) } },
            description: 'Success',
        },
    },
    security: [{ bearerAuth: [] }],
    operationId: "replaceContact",
    description: "Auto-generated placeholder for replaceContact (PUT /{id}, contacts domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended', capability: 'manageContacts' }));

const deleteContactRoute = createRoute(withMcpMetadata({
    method: 'delete', path: '/{id}',
    tags: ["contacts"], summary: "Delete contact for current tenant",
    // Task 10 — manageContacts capability gates contact CREATE/UPDATE/DELETE.
    middleware: [requireRole('owner', 'manager', 'inspector'), requireCapability('manageContacts')],
    request: { params: z.object({ id: CONTACT_ID.describe('Contact id.') }) },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.boolean().describe('TODO describe success field for the OpenInspection MCP integration') }).describe('TODO describe schema field for the OpenInspection MCP integration') } },
            description: 'Deleted',
        },
    },
    security: [{ bearerAuth: [] }],
    operationId: "deleteContact",
    description: "Auto-generated placeholder for deleteContact (DELETE /{id}, contacts domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'primary', capability: 'manageContacts' }));

/**
 * POST /api/contacts/:id/restore — undo an archive (IA-120).
 *
 * Archive wrote `archivedAt` and every read path filtered it out, so the
 * control was a one-way door behind copy that promises tidying ("Removes them
 * from your list"). This is the way back.
 *
 * It does NOT restore report access. When the tenant has archive-revokes-access
 * on, archiving killed live links; handing them back as a side effect of
 * un-hiding a row would be a silent re-grant. Re-granting is the People card's
 * job.
 */
const restoreContactRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/{id}/restore',
    tags: ["contacts"], summary: "Restore an archived contact",
    middleware: [requireRole('owner', 'manager', 'inspector'), requireCapability('manageContacts')],
    request: { params: z.object({ id: CONTACT_ID.describe('Contact id.') }) },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.object({ restored: z.boolean().describe('False when the contact was not archived, so nothing changed.') }) }) } },
            description: 'Restored, or already active (data.restored says which).',
        },
        404: { content: { 'application/json': { schema: z.object({ success: z.literal(false), error: z.object({ message: z.string(), code: z.string() }) }) } }, description: 'Contact not found in this tenant.' },
    },
    security: [{ bearerAuth: [] }],
    operationId: "restoreContact",
    description: "Clears archived_at on a tenant-owned contact. Report links revoked at archive time are NOT reissued."
}, { scopes: ['write'], tier: 'extended', capability: 'manageContacts' }));

/**
 * GET /api/contacts/:id/access — every inspection this contact can still open
 * (IA-100).
 *
 * A report link is a per-inspection token that works with no account, so
 * revoking it is not "delete the contact" and is not visible anywhere the
 * contact is. This is the read side of making it visible.
 */
const listContactAccessRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/{id}/access',
    tags: ["contacts"],
    summary: "List the live report links a contact still holds",
    description: 'Every inspection this contact can still open, by way of a live (unrevoked, unexpired) access token addressed to their email. Empty for a contact with no email.',
    middleware: [requireRole('owner', 'manager', 'inspector')],
    request: { params: z.object({ id: CONTACT_ID.describe('Contact id.') }) },
    responses: {
        200: {
            content: { 'application/json': { schema: createApiResponseSchema(z.object({
                access: z.array(z.object({
                    inspectionId:    z.string(),
                    propertyAddress: z.string().nullable(),
                    role:            z.string(),
                    createdAt:       z.number().nullable(),
                })),
            })) } },
            description: 'Live access list',
        },
        404: { description: 'Contact not found in this tenant' },
    },
    security: [{ bearerAuth: [] }],
    operationId: "listContactAccess",
    // 'extended', not 'primary': this is an administrative surface, and the
    // primary tier is a deliberately small budget for core workflow.
}, { scopes: ['read'], tier: 'extended' }));

/**
 * POST /api/contacts/:id/access/revoke — withdraw some or all of it.
 *
 * Omitting `inspectionIds` revokes everything, which is the bulk case an
 * operator reaches for when someone should no longer see anything at all.
 * Gated on manageContacts like the other mutating contact routes.
 */
const revokeContactAccessRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/{id}/access/revoke',
    tags: ["contacts"],
    summary: "Revoke a contact's report links",
    description: 'Revokes the named inspections\' links for this contact, or every live link when inspectionIds is omitted. Returns the number actually revoked, which can be lower than requested if some were already gone.',
    middleware: [requireRole('owner', 'manager', 'inspector'), requireCapability('manageContacts')],
    request: {
        params: z.object({ id: CONTACT_ID.describe('Contact id.') }),
        body: { content: { 'application/json': { schema: z.object({
            inspectionIds: z.array(z.string()).optional()
                .describe('Inspections to revoke. Omit to revoke every live link this contact holds.'),
        }) } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: createApiResponseSchema(z.object({ revoked: z.number() })) } },
            description: 'Revoked',
        },
        404: { description: 'Contact not found in this tenant' },
    },
    security: [{ bearerAuth: [] }],
    operationId: "revokeContactAccess",
}, { scopes: ['write'], tier: 'extended', capability: 'manageContacts' }));

const contactRoutes = createApiRouter()
    .openapi(listContactsRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const q = c.req.valid('query');
        const opts: { type?: ContactType; search?: string; archived?: 'exclude' | 'only'; limit: number; offset: number } =
            { limit: q.limit, offset: q.offset, archived: q.archived };
        if (q.type) opts.type = q.type;
        if (q.search) opts.search = q.search;
        const rows = await c.var.services.contact.listContacts(tenantId, opts);
        return c.json({ success: true as const, data: rows, meta: { total: rows.length } }, 200);
    })
    .openapi(restoreContactRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const { id } = c.req.valid('param');
        const { restored } = await c.var.services.contact.restoreContact(id, tenantId);
        return c.json({ success: true as const, data: { restored } }, 200);
    })
    .openapi(getContactDetailRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const { id } = c.req.valid('param');
        const detail = await c.var.services.contact.getContactDetail(id, tenantId);
        if (!detail) return c.json({ success: false, error: { message: 'Contact not found', code: 'NOT_FOUND' } }, 404);
        return c.json({ success: true as const, data: detail }, 200);
    })
    .openapi(createContactRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const data = c.req.valid('json');
        const user = c.get('user');
        const contact = await c.var.services.contact.createContact(tenantId, {
            ...data,
            createdByUserId: user?.sub ?? null,
        });
        if (c.env.QBO_CLIENT_ID) {
            c.executionCtx.waitUntil(
                c.var.services.qbo.upsertCustomer(tenantId, contact),
            );
        }
        return c.json({ success: true as const, data: { contact } }, 201);
    })
    .openapi(updateContactRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const { id } = c.req.valid('param');
        const raw = c.req.valid('json');
        // Strip undefined keys to satisfy exactOptionalPropertyTypes.
        //
        // `'x' in raw` rather than `raw.x !== undefined` for every nullable
        // field: an explicit null is how a caller CLEARS one, and testing for
        // undefined would silently discard the clear. `locale` needs that most
        // — putting a contact back to "no stated preference" is the whole
        // correction path.
        const data: Partial<{ type: ContactType; name: string; email: string | null; phone: string | null; agency: string | null; notes: string | null; locale: string | null }> = {};
        if (raw.type !== undefined) data.type = raw.type;
        if (raw.name !== undefined) data.name = raw.name;
        if ('email' in raw) data.email = raw.email ?? null;
        if ('phone' in raw) data.phone = raw.phone ?? null;
        if ('agency' in raw) data.agency = raw.agency ?? null;
        if ('notes' in raw) data.notes = raw.notes ?? null;
        if ('locale' in raw) data.locale = raw.locale ?? null;
        const contact = await c.var.services.contact.updateContact(id as string, tenantId, data);
        if (c.env.QBO_CLIENT_ID) {
            c.executionCtx.waitUntil(
                c.var.services.qbo.upsertCustomer(tenantId, contact),
            );
        }
        return c.json({ success: true as const, data: { contact } }, 200);
    })
    .openapi(deleteContactRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const { id } = c.req.valid('param');
        await c.var.services.contact.deleteContact(id as string, tenantId);
        return c.json({ success: true }, 200);
    })
    .openapi(listContactAccessRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const { id } = c.req.valid('param');
        const access = await c.var.services.contact.listAccess(id, tenantId);
        if (access === null) return c.json({ success: false as const, error: { code: 'NOT_FOUND', message: 'Contact not found' } }, 404);
        return c.json({ success: true as const, data: { access } }, 200);
    })
    .openapi(revokeContactAccessRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const { id } = c.req.valid('param');
        const { inspectionIds } = c.req.valid('json');
        const revoked = await c.var.services.contact.revokeAccess(
            id, tenantId,
            ...(inspectionIds ? [inspectionIds] as const : [] as const),
        );
        if (revoked === null) return c.json({ success: false as const, error: { code: 'NOT_FOUND', message: 'Contact not found' } }, 404);
        return c.json({ success: true as const, data: { revoked } }, 200);
    });

export type ContactsApi = typeof contactRoutes;

export default contactRoutes;
