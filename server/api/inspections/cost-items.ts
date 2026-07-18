// Commercial PCA Phase C Task 13a — cost_items CRUD API. Role-gated;
// tenant-scoped via CostItemService (JWT tenantId only — never client
// input). Mirrors the OpenAPI + response-envelope convention established by
// the sibling cost-export routes (./cost-export.ts) and the
// admin-defect-categories CRUD router (../admin/admin-defect-categories.ts).
//
// Finding-seed on POST (best-effort, IO wrapped in try/catch — never a 500):
// when the create body carries a `findingKey` and no explicit
// unitCostCents/lumpSumCents/suggestedRemedy, this reads the finding's
// snapshotted recommendations at `inspection_results.data[findingKey]`
// (the same source server/lib/report-repair-items.ts `mapRepairItems`
// reads: `res.recommendations`) and passes them as the primary
// `FindingSeedInput` to the pure `seedCostFromFinding` (Task 7). Template
// item + canned comment are intentionally passed `null` — see the report
// for why (deferred, not a correctness issue: seedCostFromFinding already
// treats missing sources as absent and falls through to the finding
// recommendations, which are the primary signal anyway).
import { createRoute, z } from '@hono/zod-openapi';
import { eq, and } from 'drizzle-orm';
import { createApiRouter } from '../../lib/openapi-router';
import { requireRole } from '../../lib/middleware/rbac';
import { getTenantId, getDrizzle } from '../../lib/route-helpers';
import { CostItemService } from '../../services/cost-item.service';
import { seedCostFromFinding, type FindingSeedInput } from '../../lib/pca-costs';
import { inspectionResults, tenantConfigs } from '../../lib/db/schema';
import { CreateCostItemSchema, UpdateCostItemSchema } from '../../lib/validations/cost-item.schema';
import { withMcpMetadata } from '../../lib/route-metadata-standards';

const CostItemResponseItem = z.object({
    id: z.string(),
    system: z.string(),
    component: z.string(),
    location: z.string(),
    action: z.enum(['repair', 'replace', 'further_study']),
    costMethod: z.enum(['unit', 'lump_sum']),
    quantity: z.number().int().nullable(),
    uom: z.string().nullable(),
    unitCostCents: z.number().int().nullable(),
    lumpSumCents: z.number().int().nullable(),
    eul: z.number().int().nullable(),
    effAge: z.number().int().nullable(),
    rul: z.number().int().nullable(),
    suggestedRemedy: z.string(),
    bucket: z.enum(['immediate', 'short_term', 'long_term']),
    sectionRef: z.string().nullable(),
    photoRef: z.string().nullable(),
    sortOrder: z.number().int(),
});

const ParamsId = z.object({ id: z.string().describe('Inspection identifier') });
const ParamsIdItemId = z.object({
    id: z.string().describe('Inspection identifier'),
    itemId: z.string().describe('Cost item identifier'),
});

const listCostItemsRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/{id}/cost-items',
    tags: ['inspections'],
    summary: 'List cost items for an inspection',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: { params: ParamsId },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.literal(true),
                        data: z.array(CostItemResponseItem),
                        // Tenant `reserveScheduleEnabled` config, piggybacked onto the
                        // list response so the BFF resource route (app/routes/
                        // resources/cost-items.tsx) doesn't need its own Drizzle
                        // access to reach it — mirrors the reserve-config read in
                        // cost-export.ts's xlsx handler and
                        // InspectionReportService.getReportData.
                        reserveEnabled: z.boolean().describe('Whether the tenant has the EUL/EFF AGE/RUL reserve schedule enabled.'),
                    }),
                },
            },
            description: 'The tenant-scoped cost items recorded for this inspection, sorted by sortOrder, plus the tenant reserve-schedule flag.',
        },
    },
    operationId: 'listInspectionCostItems',
    description: 'List every commercial PCA cost line item recorded for the inspection, in display order, for the editor panel and downstream export routes.',
}, { scopes: ['read'], tier: 'extended' }));

const createCostItemRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/{id}/cost-items',
    tags: ['inspections'],
    summary: 'Create a cost item for an inspection',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: ParamsId,
        body: { content: { 'application/json': { schema: CreateCostItemSchema } } },
    },
    responses: {
        201: {
            content: {
                'application/json': {
                    schema: z.object({ success: z.literal(true), data: z.object({ id: z.string() }) }),
                },
            },
            description: 'The newly created cost item id.',
        },
    },
    operationId: 'createInspectionCostItem',
    description: 'Create a new commercial PCA cost line item on the inspection. When findingKey is set and no explicit cost/remedy is given, the line is best-effort seeded from the finding\'s recommendation snapshot.',
}, { scopes: ['write'], tier: 'extended' }));

const updateCostItemRoute = createRoute(withMcpMetadata({
    method: 'patch',
    path: '/{id}/cost-items/{itemId}',
    tags: ['inspections'],
    summary: 'Update an existing inspection cost item',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: ParamsIdItemId,
        body: { content: { 'application/json': { schema: UpdateCostItemSchema } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true) }) } },
            description: 'Update acknowledged.',
        },
    },
    operationId: 'updateInspectionCostItem',
    description: 'Patch any subset of fields on an existing commercial PCA cost line item, tenant-scoped and restricted to the inspection it already belongs to.',
}, { scopes: ['write'], tier: 'extended' }));

const deleteCostItemRoute = createRoute(withMcpMetadata({
    method: 'delete',
    path: '/{id}/cost-items/{itemId}',
    tags: ['inspections'],
    summary: 'Delete an inspection cost item',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: { params: ParamsIdItemId },
    responses: {
        200: {
            content: { 'application/json': { schema: z.object({ success: z.literal(true) }) } },
            description: 'Delete acknowledged.',
        },
    },
    operationId: 'deleteInspectionCostItem',
    description: 'Delete a commercial PCA cost line item, tenant-scoped. Removing an item never touches the finding it was linked from.',
}, { scopes: ['write'], tier: 'extended' }));

/**
 * Best-effort finding-seed read (Task 13a, design spec §4/§5). Loads the
 * inspection's results row, reads the finding's snapshotted recommendations
 * at `data[findingKeyValue]` (same shape `mapRepairItems` reads:
 * `{ recommendations: [{ estimateSnapshotMin, estimateSnapshotMax,
 * summarySnapshot, ... }] }`, integer cents), and hands them to the pure
 * `seedCostFromFinding` as the primary source. Template item + canned
 * comment are passed null (see file header). Any failure — missing row,
 * missing key, malformed JSON — resolves to null; this must never surface
 * as a 500 on cost item creation.
 */
async function loadFindingSeed(
    db: ReturnType<typeof getDrizzle>,
    inspectionId: string,
    tenantId: string,
    findingKeyValue: string,
): Promise<{ lumpSumCents: number | null; suggestedRemedy: string } | null> {
    try {
        const row = await db.select({ data: inspectionResults.data })
            .from(inspectionResults)
            .where(and(eq(inspectionResults.inspectionId, inspectionId), eq(inspectionResults.tenantId, tenantId)))
            .get();
        if (!row?.data) return null;
        const resultData = (typeof row.data === 'string' ? JSON.parse(row.data) : row.data) as Record<string, unknown>;
        const entry = resultData[findingKeyValue] as { recommendations?: unknown } | undefined;
        if (!entry) return null;
        // `?? null` strips `undefined` from the value's static type — required
        // under exactOptionalPropertyTypes since FindingSeedInput.recommendations
        // is `... | null` (optional, but not explicit-undefined) — see the
        // matching note on the create()/update() calls below.
        const finding: FindingSeedInput = {
            recommendations: (entry.recommendations as FindingSeedInput['recommendations']) ?? null,
        };
        const seed = seedCostFromFinding(finding, null, null);
        return { lumpSumCents: seed.lumpSumCents, suggestedRemedy: seed.suggestedRemedy };
    } catch {
        return null;
    }
}

/**
 * Drops keys whose value is `undefined` and narrows the return type to match
 * (each property's static type loses its `| undefined` branch while staying
 * optional). Needed because `exactOptionalPropertyTypes` forbids assigning a
 * value typed `T | undefined` to an optional property declared `T` — the
 * Zod-inferred PATCH body always carries `| undefined` on every field
 * (`.partial()`), while `CostItemService.update`'s `Partial<CreateInput>`
 * declares its optional fields as `T | null` (no undefined).
 */
function stripUndefinedKeys<T extends object>(obj: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj)) {
        const v = (obj as Record<string, unknown>)[k];
        if (v !== undefined) out[k] = v;
    }
    return out as { [K in keyof T]?: Exclude<T[K], undefined> };
}

const costItemRoutes = createApiRouter()
    .openapi(listCostItemsRoute, async (c) => {
        const tenantId = getTenantId(c);
        const { id } = c.req.valid('param');
        const items = await new CostItemService(c.env.DB).listByInspection(id, tenantId);
        // Tenant-scoped reserve-schedule flag (JWT tenantId only — never
        // client input), same read shape as cost-export.ts's xlsx handler.
        const cfg = await getDrizzle(c)
            .select({ reserveScheduleEnabled: tenantConfigs.reserveScheduleEnabled })
            .from(tenantConfigs)
            .where(eq(tenantConfigs.tenantId, tenantId))
            .get();
        return c.json({ success: true as const, data: items, reserveEnabled: Boolean(cfg?.reserveScheduleEnabled) }, 200);
    })
    .openapi(createCostItemRoute, async (c) => {
        const tenantId = getTenantId(c);
        const { id } = c.req.valid('param');
        const input = c.req.valid('json');

        let lumpSumCents = input.lumpSumCents ?? null;
        let suggestedRemedy = input.suggestedRemedy ?? '';
        if (input.findingKey && input.unitCostCents == null && lumpSumCents == null && !suggestedRemedy) {
            const seed = await loadFindingSeed(getDrizzle(c), id, tenantId, input.findingKey);
            if (seed) {
                lumpSumCents = lumpSumCents ?? seed.lumpSumCents;
                suggestedRemedy = suggestedRemedy || seed.suggestedRemedy;
            }
        }

        // Field-by-field with `?? <default>` (not `...input`) — every optional
        // field on the Zod-inferred `input` type carries an explicit
        // `| undefined` branch, which `exactOptionalPropertyTypes` rejects
        // against CostItemService's `CreateInput` (declared `T | null`, no
        // undefined). Matches the codebase-wide "?? null at the call site"
        // convention (see e.g. inspections/core.ts, agreements.ts).
        const itemId = await new CostItemService(c.env.DB).create(tenantId, {
            inspectionId: id,
            buildingId: input.buildingId ?? null,
            instanceIndex: input.instanceIndex ?? null,
            unitId: input.unitId ?? null,
            findingKey: input.findingKey ?? null,
            system: input.system,
            component: input.component,
            location: input.location ?? '',
            action: input.action,
            costMethod: input.costMethod,
            quantity: input.quantity ?? null,
            uom: input.uom ?? null,
            unitCostCents: input.unitCostCents ?? null,
            lumpSumCents,
            eul: input.eul ?? null,
            effAge: input.effAge ?? null,
            rul: input.rul ?? null,
            suggestedRemedy,
            bucket: input.bucket,
            sectionRef: input.sectionRef ?? null,
            photoRef: input.photoRef ?? null,
            sortOrder: input.sortOrder ?? 0,
        });
        return c.json({ success: true as const, data: { id: itemId } }, 201);
    })
    .openapi(updateCostItemRoute, async (c) => {
        const tenantId = getTenantId(c);
        const { itemId } = c.req.valid('param');
        const patch = c.req.valid('json');
        // Only the keys the client actually sent should reach the SET clause
        // (a genuinely-omitted field must not overwrite existing data with
        // null). `stripUndefinedKeys` both filters those out at runtime and
        // narrows the static type to satisfy `exactOptionalPropertyTypes`
        // against `Partial<CreateInput>` (which has no `| undefined` branch
        // on its optional fields).
        await new CostItemService(c.env.DB).update(itemId, tenantId, stripUndefinedKeys(patch));
        return c.json({ success: true as const }, 200);
    })
    .openapi(deleteCostItemRoute, async (c) => {
        const tenantId = getTenantId(c);
        const { itemId } = c.req.valid('param');
        await new CostItemService(c.env.DB).remove(itemId, tenantId);
        return c.json({ success: true as const }, 200);
    });

export default costItemRoutes;
