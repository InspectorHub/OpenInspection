// Units tree, observer links, and report versions sub-router.
// Behavior-preserving extraction from inspections.ts — handler bodies + route
// definitions are byte-identical to the original (only their location changed).
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { requireRole } from '../../lib/middleware/rbac';
import { Errors } from '../../lib/errors';
import { CreateUnitSchema, UpdateUnitSchema, MoveUnitSchema } from '../../lib/validations/unit.schema';
import { SuccessResponseSchema } from '../../lib/validations/shared.schema';
import { withMcpMetadata } from '../../lib/route-metadata-standards';

// -----------------------------------------------------------------------------
// Design System 0520 subsystem D phase 1 task 1.3 — UnitTree CRUD routes.
// -----------------------------------------------------------------------------
// Building / Floor / Unit hierarchy under each inspection. Backend
// validation in UnitService (depth ≤ 3, sibling-name uniqueness, cycle
// detection on move). Routes guard with the standard inspector role.

export const createUnitRoute = createRoute(withMcpMetadata({
    method:     'post',
    path:       '/{id}/units',
    tags: ["inspections"],
    summary:    'Create a unit (Building / Floor / Unit) under an inspection',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
        body: { content: { 'application/json': { schema: CreateUnitSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } },
    },
    responses: {
        200: { description: 'created', content: { 'application/json': { schema: z.object({ success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'), data: z.object({ id: z.string().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration') }) } } },
        400: { description: 'validation / depth / duplicate-name' },
    },
    operationId: "createInspectionUnits",
    description: "Auto-generated placeholder for createInspectionUnits (POST /{id}/units, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

export const listUnitsRoute = createRoute(withMcpMetadata({
    method:     'get',
    path:       '/{id}/units',
    tags: ["inspections"],
    summary:    'List units for an inspection (flat — client builds tree)',
    middleware: [requireRole('owner', 'manager', 'inspector', 'agent')] as const,
    request:    { params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
    responses:  {
        200: { description: 'ok' },
    },
    operationId: "listInspectionUnits",
    description: "Auto-generated placeholder for listInspectionUnits (GET /{id}/units, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' }));

export const updateUnitRoute = createRoute(withMcpMetadata({
    method:     'patch',
    path:       '/{id}/units/{unitId}',
    tags: ["inspections"],
    summary:    'Rename or re-sort a unit',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration'), unitId: z.string().min(1).describe('TODO describe unitId field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
        body: { content: { 'application/json': { schema: UpdateUnitSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } },
    },
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: SuccessResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } } },
    operationId: "patchInspectionUnit",
    description: "Auto-generated placeholder for patchInspectionUnit (PATCH /{id}/units/{unitId}, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

export const deleteUnitRoute = createRoute(withMcpMetadata({
    method:     'delete',
    path:       '/{id}/units/{unitId}',
    tags: ["inspections"],
    summary:    'Delete a unit (cascades to children)',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request:    { params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration'), unitId: z.string().min(1).describe('TODO describe unitId field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
    responses:  { 200: { description: 'ok', content: { 'application/json': { schema: SuccessResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } } },
    operationId: "deleteInspectionUnit",
    description: "Auto-generated placeholder for deleteInspectionUnit (DELETE /{id}/units/{unitId}, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

export const moveUnitRoute = createRoute(withMcpMetadata({
    method:     'post',
    path:       '/{id}/units/{unitId}/move',
    tags: ["inspections"],
    summary:    'Reparent + reorder atomically (cycle-detected)',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration'), unitId: z.string().min(1).describe('TODO describe unitId field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
        body: { content: { 'application/json': { schema: MoveUnitSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } },
    },
    responses: {
        200: { description: 'ok', content: { 'application/json': { schema: SuccessResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } },
        400: { description: 'cycle detected' },
    },
    operationId: "createInspectionUnitsMove",
    description: "Auto-generated placeholder for createInspectionUnitsMove (POST /{id}/units/{unitId}/move, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

// -----------------------------------------------------------------------------
// Design System 0520 subsystem D phase 4 task 4.3 — ObserverLink routes.
// -----------------------------------------------------------------------------
// Mint / list / revoke for the no-account read-only viewer flow. The
// anonymous /observe/:token claim handler is mounted at the top level
// in server/index.ts because it does not sit under /api/inspections/:id.

export const mintObserverLinkRoute = createRoute(withMcpMetadata({
    method:     'post',
    path:       '/{id}/observer-links',
    tags: ["inspections"],
    summary:    'Mint a no-account read-only viewer link',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
        body: { content: { 'application/json': { schema: z.object({
            durationSeconds: z.number().int().min(60).max(30 * 86400).optional().describe('TODO describe durationSeconds field for the OpenInspection MCP integration'),
        }).describe('TODO describe schema field for the OpenInspection MCP integration') } } },
    },
    responses: { 200: { description: 'ok' } },
    operationId: "createInspectionObserverLinks",
    description: "Auto-generated placeholder for createInspectionObserverLinks (POST /{id}/observer-links, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

export const listObserverLinksRoute = createRoute(withMcpMetadata({
    method:     'get',
    path:       '/{id}/observer-links',
    tags: ["inspections"],
    summary:    'List active observer links for an inspection',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request:    { params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
    responses:  { 200: { description: 'ok' } },
    operationId: "listInspectionObserverLinks",
    description: "Auto-generated placeholder for listInspectionObserverLinks (GET /{id}/observer-links, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' }));

export const revokeObserverLinkRoute = createRoute(withMcpMetadata({
    method:     'delete',
    path:       '/{id}/observer-links/{linkId}',
    tags: ["inspections"],
    summary:    'Revoke an observer link',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request:    { params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration'), linkId: z.string().min(1).describe('TODO describe linkId field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
    responses:  { 200: { description: 'ok', content: { 'application/json': { schema: SuccessResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } } },
    operationId: "deleteInspectionObserverLink",
    description: "Auto-generated placeholder for deleteInspectionObserverLink (DELETE /{id}/observer-links/{linkId}, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

// -----------------------------------------------------------------------------
// Design System 0520 subsystem D phase 7 task 7.3 — ReportVersions routes.
// -----------------------------------------------------------------------------
// List + get-snapshot + diff. snapshotOnPublish is invoked from the
// existing publish flow as part of subsystem D P9 (Republish UX, separate
// commit) — only the read APIs land here.

export const listVersionsRoute = createRoute(withMcpMetadata({
    method:     'get',
    path:       '/{id}/versions',
    tags: ["inspections"],
    summary:    'List published versions for an inspection',
    middleware: [requireRole('owner', 'manager', 'inspector', 'agent')] as const,
    request:    { params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
    responses:  { 200: { description: 'ok' } },
    operationId: "listInspectionVersions",
    description: "Auto-generated placeholder for listInspectionVersions (GET /{id}/versions, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' }));

export const getVersionRoute = createRoute(withMcpMetadata({
    method:     'get',
    path:       '/{id}/versions/{n}',
    tags: ["inspections"],
    summary:    'Get full snapshot for a specific version',
    middleware: [requireRole('owner', 'manager', 'inspector', 'agent')] as const,
    request:    { params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration'), n: z.string().regex(/^\d+$/).describe('TODO describe n field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
    responses:  { 200: { description: 'ok' }, 404: { description: 'not found' } },
    operationId: "getInspectionVersion",
    description: "Auto-generated placeholder for getInspectionVersion (GET /{id}/versions/{n}, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' }));

export const diffVersionRoute = createRoute(withMcpMetadata({
    method:     'get',
    path:       '/{id}/versions/{n}/diff',
    tags: ["inspections"],
    summary:    'Diff version :n against ?from=<version>',
    middleware: [requireRole('owner', 'manager', 'inspector', 'agent')] as const,
    request: {
        params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration'), n: z.string().regex(/^\d+$/).describe('TODO describe n field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
        query:  z.object({ from: z.string().regex(/^\d+$/).describe('TODO describe from field for the OpenInspection MCP integration') }).describe('TODO describe query field for the OpenInspection MCP integration'),
    },
    responses: { 200: { description: 'ok' }, 404: { description: 'one of the versions not found' } },
    operationId: "listInspectionVersionsDiff",
    description: "Auto-generated placeholder for listInspectionVersionsDiff (GET /{id}/versions/{n}/diff, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' }));


const hierarchyRoutes = createApiRouter()
    .openapi(createUnitRoute, async (c) => {
        const { id }      = c.req.valid('param');
        const input       = c.req.valid('json');
        const tenantId    = c.get('tenantId');
        try {
            const out = await c.var.services.unit.create(tenantId, { inspectionId: id, ...input });
            return c.json({ success: true as const, data: out }, 200);
        } catch (err) {
            throw Errors.BadRequest((err as Error).message);
        }
    })
    .openapi(listUnitsRoute, async (c) => {
        const { id }   = c.req.valid('param');
        const tenantId = c.get('tenantId');
        const units    = await c.var.services.unit.list(tenantId, id);
        return c.json({ success: true as const, data: { units } }, 200);
    })
    .openapi(updateUnitRoute, async (c) => {
        const { unitId } = c.req.valid('param');
        const patch      = c.req.valid('json');
        await c.var.services.unit.update(c.get('tenantId'), unitId, patch);
        return c.json({ success: true as const }, 200);
    })
    .openapi(deleteUnitRoute, async (c) => {
        const { unitId } = c.req.valid('param');
        await c.var.services.unit.delete(c.get('tenantId'), unitId);
        return c.json({ success: true as const }, 200);
    })
    .openapi(moveUnitRoute, async (c) => {
        const { unitId } = c.req.valid('param');
        const { newParentUnitId, newSortOrder } = c.req.valid('json');
        try {
            await c.var.services.unit.move(c.get('tenantId'), unitId, newParentUnitId, newSortOrder);
            return c.json({ success: true as const }, 200);
        } catch (err) {
            throw Errors.BadRequest((err as Error).message);
        }
    })
    .openapi(mintObserverLinkRoute, async (c) => {
        const { id }   = c.req.valid('param');
        const { durationSeconds } = c.req.valid('json');
        const createdBy = (c.get('user') as { sub?: string } | undefined)?.sub;
        if (!createdBy) throw Errors.Unauthorized('Missing user identity');

        const out = await c.var.services.observerLink.mint(c.get('tenantId'), {
            inspectionId: id,
            createdBy,
            ...(durationSeconds !== undefined ? { durationSeconds } : {}),
        });

        // Augment the bare service output with a fully-qualified claim URL
        // so the InspectorToolsDock modal can render a copy-and-paste field
        // without re-deriving the host or token path on the client.
        const baseUrl = c.env.APP_BASE_URL || `https://${c.req.header('host') ?? ''}`;
        const url     = `${baseUrl}/observe/${out.token}`;
        return c.json({ success: true as const, data: { ...out, url } }, 200);
    })
    .openapi(listObserverLinksRoute, async (c) => {
        const { id } = c.req.valid('param');
        const links  = await c.var.services.observerLink.list(c.get('tenantId'), id);
        return c.json({ success: true as const, data: { links } }, 200);
    })
    .openapi(revokeObserverLinkRoute, async (c) => {
        const { linkId } = c.req.valid('param');
        await c.var.services.observerLink.revoke(c.get('tenantId'), linkId);
        return c.json({ success: true as const }, 200);
    })
    .openapi(listVersionsRoute, async (c) => {
        const { id } = c.req.valid('param');
        const versions = await c.var.services.reportVersion.list(c.get('tenantId'), id);
        return c.json({ success: true as const, data: { versions } }, 200);
    })
    .openapi(getVersionRoute, async (c) => {
        const { id, n } = c.req.valid('param');
        const snap = await c.var.services.reportVersion.get(c.get('tenantId'), id, parseInt(n, 10));
        if (!snap) throw Errors.NotFound('Version not found');
        return c.json({ success: true as const, data: snap }, 200);
    })
    .openapi(diffVersionRoute, async (c) => {
        const { id, n } = c.req.valid('param');
        const { from }  = c.req.valid('query');
        const diff = await c.var.services.reportVersion.diff(
            c.get('tenantId'), id, parseInt(from, 10), parseInt(n, 10),
        );
        if (!diff) throw Errors.NotFound('Version diff not available');
        return c.json({ success: true as const, data: diff }, 200);
    })
    // Typed-Hono dead-routes cleanup Task 10 — vectorised result patches.;

export default hierarchyRoutes;
