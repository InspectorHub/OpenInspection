// Units tree and report versions sub-router.
// Behavior-preserving extraction from inspections.ts — handler bodies + route
// definitions are byte-identical to the original (only their location changed).
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { requireRole } from '../../lib/middleware/rbac';
import { Errors } from '../../lib/errors';
import { CreateUnitSchema, UpdateUnitSchema, MoveUnitSchema, BulkCreateUnitsSchema, UnitModeSwitchSchema } from '../../lib/validations/unit.schema';
import { SuccessResponseSchema } from '../../lib/validations/shared.schema';
import { withMcpMetadata } from '../../lib/route-metadata-standards';
import { expandFloorsStacks, parseUnitCsv } from '../../lib/unit-pattern';
import { computeUnitProgress } from '../../lib/unit-progress';
import { inspectionResults } from '../../lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { getDrizzle } from '../../lib/route-helpers';

// -----------------------------------------------------------------------------
// Design System 0520 subsystem D phase 1 task 1.3 — UnitTree CRUD routes.
// -----------------------------------------------------------------------------
// Building / Floor / Unit hierarchy under each inspection. Backend
// validation in UnitService (depth ≤ 3, sibling-name uniqueness, cycle
// detection on move). Routes guard with the standard inspector role.

const createUnitRoute = createRoute(withMcpMetadata({
    method:     'post',
    path:       '/{id}/units',
    tags: ["inspections"],
    summary:    'Create a unit (Building / Floor / Unit) under an inspection',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({ id: z.string().trim().min(1).describe('Inspection the unit belongs to.') }),
        body: { content: { 'application/json': { schema: CreateUnitSchema.describe('Where the new node sits in the tree (parent, or null for top level), what kind of node it is and its name.') } } },
    },
    responses: {
        200: { description: 'created', content: { 'application/json': { schema: z.object({ success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'), data: z.object({ id: z.string().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration') }) } } },
        400: { description: 'validation / depth / duplicate-name' },
    },
    operationId: "createInspectionUnits",
    description: "Adds one node (building, floor or unit) to the inspection's unit tree and returns its id. The tree is at most three levels deep below the top, so a parent that is already at the deepest level is refused, and a name already used by a sibling under the same parent is refused; both come back as 400. The new node is sorted after its existing siblings. The inspection id is not looked up first, so an unknown id simply produces a node no inspection shows. Available to owner, manager and inspector roles."
}, { scopes: ['write'], tier: 'extended' }));

// Commercial PCA Phase U — bulk-create N units (floors×stacks / CSV paste) and
// duplicate a unit's attributes into a new empty sibling. Same mount, same
// requireRole guard, same c.var.services.unit as the single-create route.
const bulkCreateUnitsRoute = createRoute(withMcpMetadata({
    method:     'post',
    path:       '/{id}/units/bulk',
    tags: ["inspections"],
    summary:    'Bulk-create units under an inspection (floors×stacks or CSV)',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({ id: z.string().trim().min(1).describe('Inspection the units are added to.') }),
        body: { content: { 'application/json': { schema: BulkCreateUnitsSchema.describe('Either a floors-by-stacks grid or CSV text, plus the optional parent node to create the units under.') } } },
    },
    responses: {
        200: { description: 'created', content: { 'application/json': { schema: z.object({ success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'), data: z.object({ ids: z.array(z.string()).describe('TODO describe ids field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration') }) } } },
        400: { description: 'validation' },
    },
    operationId: "bulkCreateInspectionUnits",
    description: "Creates many units at once under one parent (or at the top level) and returns their ids. Two input styles: a floors-by-stacks grid, or pasted CSV text, each expanded into labelled units. Every created node is a regular unit. Labels that collide with an existing sibling or repeat within the batch are skipped silently, so the returned ids can be fewer than requested, or empty. All rows are inserted together. Refused with 400 when the parent is already at the deepest allowed level or the input cannot be parsed. Available to owner, manager and inspector roles."
}, { scopes: ['write'], tier: 'extended' }));

const duplicateUnitRoute = createRoute(withMcpMetadata({
    method:     'post',
    path:       '/{id}/units/{unitId}/duplicate',
    tags: ["inspections"],
    summary:    'Duplicate a unit (clone attributes into a new empty sibling)',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({ id: z.string().trim().min(1).describe('Inspection the unit belongs to.'), unitId: z.string().min(1).describe('Unit to copy.') }),
    },
    responses: {
        200: { description: 'duplicated', content: { 'application/json': { schema: z.object({ success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'), data: z.object({ id: z.string().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration') }) } } },
        400: { description: 'unit not found' },
    },
    operationId: "duplicateInspectionUnit",
    description: "Makes a copy of a unit as a new sibling and returns the new id. The copy keeps the original's kind, type, parent and stored attributes, gets a derived copy name that avoids sibling collisions, and is sorted last among its siblings. Findings entered against the original are not copied, so the new unit starts empty. Children of the unit are not duplicated. Refused with 400 when the unit does not exist or belongs to a different inspection. Available to owner, manager and inspector roles."
}, { scopes: ['write'], tier: 'extended' }));

// Commercial PCA Phase U (Batch C2a) — flip an inspection between tagged and
// per_unit mode. Delegates to c.var.services.unitSwitch (Batch B); the
// per_unit → tagged direction is LOSSY (drops the unit rows + matrix). Same
// requireRole guard as the other write routes on this mount.
const unitModeSwitchRoute = createRoute(withMcpMetadata({
    method:     'post',
    path:       '/{id}/unit-mode',
    tags: ["inspections"],
    summary:    'Switch an inspection between tagged and per-unit inspection mode',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({ id: z.string().trim().min(1).describe('Inspection id whose unit-inspection mode is switched') }),
        body: { content: { 'application/json': { schema: UnitModeSwitchSchema } } },
    },
    responses: {
        200: { description: 'switched', content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.record(z.string(), z.unknown()) }) } } },
        400: { description: 'switch failed (e.g. inspection not found in this tenant)' },
    },
    operationId: "switchInspectionUnitMode",
    description: "Switches inspections.unit_inspection_mode. mode='per_unit' promotes location tags into unit rows and re-keys unambiguous findings; mode='tagged' is the lossy reverse (flattens unit findings back to the common scope, unions labels into location_options, deletes the promoted unit rows)."
}, { scopes: ['write'], tier: 'extended' }));

// Commercial PCA Phase U (Batch C2a) — lightweight per-unit progress summary.
// Computes rated/total per unit + the common scope SERVER-SIDE from one results
// row + the template snapshot, so the scope switcher never has to pull the full
// results map. Same roles as listUnits (read, includes agent).
const unitProgressRoute = createRoute(withMcpMetadata({
    method:     'get',
    path:       '/{id}/unit-progress',
    tags: ["inspections"],
    summary:    'Per-unit rated/total progress summary (server-computed, no full map)',
    middleware: [requireRole('owner', 'manager', 'inspector', 'agent')] as const,
    request:    { params: z.object({ id: z.string().trim().min(1).describe('Inspection id whose per-unit progress is summarized') }) },
    responses:  { 200: { description: 'ok' } },
    operationId: "listInspectionUnitProgress",
    description: "Returns { units: [{ unitId, rated, total }], commonRated, total } for an inspection. `total` is the template item count; `rated` counts each scope's findings that carry a truthy rating. Computed server-side from one results row to avoid shipping the full results map to the client."
}, { scopes: ['read'], tier: 'extended' }));

const listUnitsRoute = createRoute(withMcpMetadata({
    method:     'get',
    path:       '/{id}/units',
    tags: ["inspections"],
    summary:    'List units for an inspection (flat — client builds tree)',
    middleware: [requireRole('owner', 'manager', 'inspector', 'agent')] as const,
    request:    { params: z.object({ id: z.string().trim().min(1).describe('Inspection id.') }) },
    responses:  {
        200: { description: 'ok' },
    },
    operationId: "listInspectionUnits",
    description: "List the units of an inspection as a flat list; the client assembles the tree."
}, { scopes: ['read'], tier: 'extended' }));

const updateUnitRoute = createRoute(withMcpMetadata({
    method:     'patch',
    path:       '/{id}/units/{unitId}',
    tags: ["inspections"],
    summary:    'Rename or re-sort a unit',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({ id: z.string().trim().min(1).describe('Inspection the unit belongs to (not checked against the unit by this route).'), unitId: z.string().min(1).describe('Unit to rename or reorder.') }),
        body: { content: { 'application/json': { schema: UpdateUnitSchema.describe('New name and or new sort position; omit a field to leave it as is.') } } },
    },
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: SuccessResponseSchema } } } },
    operationId: "patchInspectionUnit",
    description: "Renames a unit or changes its sort position; fields left out are unchanged. Sibling-name uniqueness is not re-checked on rename. The unit is looked up by its own id within the company only, so the inspection id in the path is not verified against it, and an unknown unit id succeeds without changing anything. Available to owner, manager and inspector roles."
}, { scopes: ['write'], tier: 'extended' }));

const deleteUnitRoute = createRoute(withMcpMetadata({
    method:     'delete',
    path:       '/{id}/units/{unitId}',
    tags: ["inspections"],
    summary:    'Delete a unit (cascades to children)',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request:    { params: z.object({ id: z.string().trim().min(1).describe('Inspection the unit belongs to (not checked against the unit by this route).'), unitId: z.string().min(1).describe('Unit to delete along with all of its descendants.') }) },
    responses:  { 200: { description: 'ok', content: { 'application/json': { schema: SuccessResponseSchema } } } },
    operationId: "deleteInspectionUnit",
    description: "Deletes a unit together with every unit nested beneath it. Findings recorded against the deleted units are not removed by this route. The unit is looked up by its own id within the company only, so the inspection id in the path is not verified against it, and an unknown unit id still returns success. Cannot be undone. Available to owner, manager and inspector roles."
}, { scopes: ['write'], tier: 'extended' }));

const moveUnitRoute = createRoute(withMcpMetadata({
    method:     'post',
    path:       '/{id}/units/{unitId}/move',
    tags: ["inspections"],
    summary:    'Reparent + reorder atomically (cycle-detected)',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({ id: z.string().trim().min(1).describe('Inspection the unit belongs to (not checked against the unit by this route).'), unitId: z.string().min(1).describe('Unit to move.') }),
        body: { content: { 'application/json': { schema: MoveUnitSchema.describe('The new parent (null for top level) and the new sort position.') } } },
    },
    responses: {
        200: { description: 'ok', content: { 'application/json': { schema: SuccessResponseSchema } } },
        400: { description: 'cycle detected' },
    },
    operationId: "createInspectionUnitsMove",
    description: "Moves a unit under a different parent (or to the top level) and sets its sort position in one step. Refused with 400 if the new parent is the unit itself or one of its descendants, since that would create a cycle. The three-level depth limit is not re-checked on a move, and the inspection id in the path is not verified against the unit. Available to owner, manager and inspector roles."
}, { scopes: ['write'], tier: 'extended' }));

// -----------------------------------------------------------------------------
// Design System 0520 subsystem D phase 7 task 7.3 — ReportVersions routes.
// -----------------------------------------------------------------------------
// List + get-snapshot + diff. snapshotOnPublish is invoked from the
// existing publish flow as part of subsystem D P9 (Republish UX, separate
// commit) — only the read APIs land here.

const listVersionsRoute = createRoute(withMcpMetadata({
    method:     'get',
    path:       '/{id}/versions',
    tags: ["inspections"],
    summary:    'List published versions for an inspection',
    middleware: [requireRole('owner', 'manager', 'inspector', 'agent')] as const,
    request:    { params: z.object({ id: z.string().trim().min(1).describe('Id of the inspection whose published versions to list.') }) },
    responses:  { 200: { description: 'ok' } },
    operationId: "listInspectionVersions",
    description: "Lists the published report versions of an inspection, newest version first, each with its version number, publish time (Unix seconds), the user id that published it and the optional publish summary. Only metadata is returned, not the snapshot content; use the single-version route for that. The list is filtered by inspection, not by report, so an inspection with several reports lists versions of all of them. Not paginated. Read-only. Available to owner, manager, inspector and agent roles."
}, { scopes: ['read'], tier: 'extended' }));

const getVersionRoute = createRoute(withMcpMetadata({
    method:     'get',
    path:       '/{id}/versions/{n}',
    tags: ["inspections"],
    summary:    'Get full snapshot for a specific version',
    middleware: [requireRole('owner', 'manager', 'inspector', 'agent')] as const,
    request:    { params: z.object({ id: z.string().trim().min(1).describe('Id of the inspection whose published versions to read.'), n: z.string().regex(/^\d+$/).describe('Version number to fetch, as listed by the versions route.') }) },
    responses:  { 200: { description: 'ok' }, 404: { description: 'not found' } },
    operationId: "getInspectionVersion",
    description: "Returns the full frozen snapshot captured when version n was published: the inspection record, its results data, its units, the inspectors credited at the time and the resolved report style. Reads the stored copy, so later edits to the live inspection do not change it. Returns 404 when no such version exists for the inspection in this company. Read-only. Available to owner, manager, inspector and agent roles."
}, { scopes: ['read'], tier: 'extended' }));

const diffVersionRoute = createRoute(withMcpMetadata({
    method:     'get',
    path:       '/{id}/versions/{n}/diff',
    tags: ["inspections"],
    summary:    'Diff version :n against ?from=<version>',
    middleware: [requireRole('owner', 'manager', 'inspector', 'agent')] as const,
    request: {
        params: z.object({ id: z.string().trim().min(1).describe('Id of the inspection whose published versions to compare.'), n: z.string().regex(/^\d+$/).describe('Version number to compare, as listed by the versions route; this is the newer side of the diff.') }),
        query:  z.object({ from: z.string().regex(/^\d+$/).describe('Version number to compare against, as listed by the versions route; this is the baseline side of the diff.') }),
    },
    responses: { 200: { description: 'ok' }, 404: { description: 'one of the versions not found' } },
    operationId: "listInspectionVersionsDiff",
    description: "Compares two published versions of an inspection and returns the differences between the snapshot named by the from query parameter and version n in the path. Returns 404 if either version does not exist for the inspection in this company. Computed on demand from the stored snapshots and nothing is written. Read-only. Available to owner, manager, inspector and agent roles."
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
    .openapi(bulkCreateUnitsRoute, async (c) => {
        const { id }   = c.req.valid('param');
        const body     = c.req.valid('json');
        const tenantId = c.get('tenantId');
        const drafts = body.mode === 'floors_stacks'
            ? expandFloorsStacks({
                floors: body.floors, stacks: body.stacks,
                ...(body.startAt !== undefined ? { startAt: body.startAt } : {}),
              })
            : parseUnitCsv(body.csv);
        try {
            const out = await c.var.services.unit.createMany(tenantId, id, drafts, {
                parentUnitId: body.parentUnitId ?? null,
                kind: 'unit',
                type: 'unit',
            });
            return c.json({ success: true as const, data: out }, 200);
        } catch (err) {
            throw Errors.BadRequest((err as Error).message);
        }
    })
    .openapi(duplicateUnitRoute, async (c) => {
        const { id, unitId } = c.req.valid('param');
        try {
            // Scope the duplicate to this inspection so a unit from another
            // inspection cannot be cloned through this URL.
            const out = await c.var.services.unit.duplicate(c.get('tenantId'), unitId, id);
            return c.json({ success: true as const, data: out }, 200);
        } catch (err) {
            throw Errors.BadRequest((err as Error).message);
        }
    })
    .openapi(unitModeSwitchRoute, async (c) => {
        const { id }   = c.req.valid('param');
        const { mode } = c.req.valid('json');
        const tenantId = c.get('tenantId');
        try {
            const data = mode === 'per_unit'
                ? await c.var.services.unitSwitch.toPerUnit(tenantId, id)
                : await c.var.services.unitSwitch.toTagged(tenantId, id);
            return c.json({ success: true as const, data }, 200);
        } catch (err) {
            throw Errors.BadRequest((err as Error).message);
        }
    })
    .openapi(unitProgressRoute, async (c) => {
        const { id }   = c.req.valid('param');
        const tenantId = c.get('tenantId');
        // Ownership guard + source of the template snapshot (denominator).
        const { inspection } = await c.var.services.inspection.getInspection(id, tenantId);
        const units = (await c.var.services.unit.list(tenantId, id)).filter((u: { kind: string }) => u.kind === 'unit');
        // One tenant-scoped results row read — computeUnitProgress does the rest
        // server-side; the full map never leaves the worker.
        const db  = getDrizzle(c);
        const row = await db.select().from(inspectionResults)
            .where(and(eq(inspectionResults.inspectionId, id), eq(inspectionResults.tenantId, tenantId)))
            .get();
        const data = (row?.data || {}) as Record<string, unknown>;
        const summary = computeUnitProgress(
            data,
            (inspection as { templateSnapshot?: unknown }).templateSnapshot,
            units.map((u: { id: string }) => u.id),
        );
        return c.json({ success: true as const, data: summary }, 200);
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
