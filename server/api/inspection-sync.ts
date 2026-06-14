import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { drizzle } from 'drizzle-orm/d1';
import { and, eq } from 'drizzle-orm';
import { requireRole } from '../lib/middleware/rbac';
import { Errors } from '../lib/errors';
import { auditFromContext } from '../lib/audit';
import { mergeResults, type ResultsBlob, type DirtyFieldsMap } from '../services/diff3.service';
import {
    ResultsMergeRequestSchema,
    ResultsMergeResponseSchema,
    MergeConflictSchema,
    ResultsBlobSchema,
    InspectorSignatureSchema,
} from '../lib/validations/sync.schema';
import { inspections, inspectionResults, templates, inspectionConflicts } from '../lib/db/schema';
import { withMcpMetadata } from "../lib/route-metadata-standards";

export const syncRoutes = createApiRouter()
/* ── POST /api/inspections/:id/results/merge ──────────────────────────────── */
    .openapi(createRoute(withMcpMetadata({
    method: 'post',
    path: '/{id}/results/merge',
    tags: ["inspections"],
    summary: 'Three-way merge sync of offline results',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
        body: { content: { 'application/json': { schema: ResultsMergeRequestSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: ResultsMergeResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } },
            description: 'Merged',
        },
        409: {
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.literal(false).describe('TODO describe success field for the OpenInspection MCP integration'),
                        error: z.object({
                            code: z.literal('MERGE_CONFLICT').describe('TODO describe code field for the OpenInspection MCP integration'),
                            message: z.string().describe('TODO describe message field for the OpenInspection MCP integration'),
                            details: z.object({
                                base:      ResultsBlobSchema.describe('TODO describe base field for the OpenInspection MCP integration'),
                                theirs:    ResultsBlobSchema.describe('TODO describe theirs field for the OpenInspection MCP integration'),
                                conflicts: z.array(MergeConflictSchema).describe('TODO describe conflicts field for the OpenInspection MCP integration'),
                            }).describe('TODO describe details field for the OpenInspection MCP integration'),
                        }),
                    }).openapi('MergeConflictResponse'),
                },
            },
            description: 'Conflict — inspector adjudication required',
        },
    },
    operationId: "mergeInspection",
    description: "Auto-generated placeholder for mergeInspection (POST /{id}/results/merge, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' })), async (c) => {
    const { id } = c.req.valid('param');
    const { base, ours, dirtyFields } = c.req.valid('json');
    const tenantId = c.get('tenantId') as string;
    const db = drizzle(c.env.DB);

    const insp = await db.select().from(inspections)
        .where(and(eq(inspections.id, id), eq(inspections.tenantId, tenantId))).get();
    if (!insp) throw Errors.NotFound('Inspection not found');

    const row = await db.select().from(inspectionResults)
        .where(and(eq(inspectionResults.inspectionId, id), eq(inspectionResults.tenantId, tenantId))).get();

    const theirs: ResultsBlob = (row?.data as ResultsBlob) ?? {};

    // True 3-way merge: client supplies its last server-confirmed `base` snapshot
    // (server doesn't keep result history). diff3 uses base to distinguish the
    // client's edits from server-side third-party concurrent writes.
    //
    // Iter-2 bug #11 — `dirtyFields` narrows the conflict surface so untouched
    // local fields silently take theirs (no modal). When the client omits the
    // field we fall through to the original "compare every field" behaviour.
    const { merged, conflicts } = mergeResults(
        base as ResultsBlob,
        ours as ResultsBlob,
        theirs,
        dirtyFields as DirtyFieldsMap | undefined,
    );

    if (conflicts.length > 0) {
        // Persist each conflict BEFORE returning the 409 so the conflict-resolver
        // UI can re-fetch them via GET /api/inspections/:id/conflicts. The diff3
        // MergeConflict shape is { itemId, field:'notes', base, ours, theirs } —
        // `ours` → local, `theirs` → remote, and notes conflicts have no
        // sectionId (notes are item-level), so section_id is null.
        const createdAt = new Date().toISOString();
        for (const cf of conflicts) {
            await db.insert(inspectionConflicts).values({
                id:           crypto.randomUUID(),
                tenantId,
                inspectionId: id,
                itemId:       cf.itemId,
                sectionId:    null,
                field:        cf.field,
                base:         typeof cf.base   === 'string' ? cf.base   : JSON.stringify(cf.base),
                local:        typeof cf.ours   === 'string' ? cf.ours   : JSON.stringify(cf.ours),
                remote:       typeof cf.theirs === 'string' ? cf.theirs : JSON.stringify(cf.theirs),
                createdAt,
            });
        }

        return c.json({
            success: false as const,
            error: {
                code: 'MERGE_CONFLICT' as const,
                message: 'Field-level conflicts require inspector adjudication',
                details: { base: base as ResultsBlob, theirs, conflicts },
            },
        }, 409);
    }

    const newSyncedAt = new Date();
    if (row) {
        await db.update(inspectionResults)
            .set({ data: merged as unknown as object, lastSyncedAt: newSyncedAt })
            .where(eq(inspectionResults.id, row.id));
    } else {
        await db.insert(inspectionResults).values({
            id: crypto.randomUUID(),
            tenantId,
            inspectionId: id,
            data: merged as unknown as object,
            lastSyncedAt: newSyncedAt,
        });
    }

    auditFromContext(c, 'inspection.results_merged', 'inspection', {
        entityId: id,
        metadata: { items: Object.keys(merged).length, autoMerged: true },
    });

    return c.json({
        success: true as const,
        data: {
            merged,
            syncedAt: Math.floor(newSyncedAt.getTime() / 1000),
            conflicts: [] as Array<never>,
        },
    }, 200);
})
/* ── DELETE /api/inspections/:id/items/:itemId/photos/:photoIndex ─────────── */
    .openapi(createRoute(withMcpMetadata({
    method: 'delete',
    path: '/{id}/items/{itemId}/photos/{photoIndex}',
    tags: ["inspections"],
    summary: 'Authoritative delete of a photo from a result item',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({
            id:         z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration'),
            itemId:     z.string().describe('TODO describe itemId field for the OpenInspection MCP integration'),
            photoIndex: z.coerce.number().int().nonnegative().describe('TODO describe photoIndex field for the OpenInspection MCP integration'),
        }).describe('TODO describe params field for the OpenInspection MCP integration'),
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'),
                        data: z.object({ deletedKey: z.string().nullable().describe('TODO describe deletedKey field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration'),
                    }),
                },
            },
            description: 'Deleted',
        },
    },
    operationId: "deleteInspectionItemsPhoto",
    description: "Auto-generated placeholder for deleteInspectionItemsPhoto (DELETE /{id}/items/{itemId}/photos/{photoIndex}, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' })), async (c) => {
    const { id, itemId, photoIndex } = c.req.valid('param');
    const tenantId = c.get('tenantId') as string;
    const db = drizzle(c.env.DB);

    const insp = await db.select().from(inspections)
        .where(and(eq(inspections.id, id), eq(inspections.tenantId, tenantId))).get();
    if (!insp) throw Errors.NotFound('Inspection not found');

    const row = await db.select().from(inspectionResults)
        .where(and(eq(inspectionResults.inspectionId, id), eq(inspectionResults.tenantId, tenantId))).get();
    if (!row) throw Errors.NotFound('Results not found');

    const data = row.data as Record<string, { photos?: Array<{ key: string }> }>;
    const photos = data[itemId]?.photos ?? [];
    if (photoIndex >= photos.length) throw Errors.NotFound('Photo index out of range');

    const deletedKey = photos[photoIndex]?.key ?? null;
    photos.splice(photoIndex, 1);

    await db.update(inspectionResults)
        .set({ data: data as unknown as object, lastSyncedAt: new Date() })
        .where(eq(inspectionResults.id, row.id));

    if (deletedKey && c.env.PHOTOS) {
        await c.env.PHOTOS.delete(deletedKey).catch(() => {});
    }

    return c.json({ success: true as const, data: { deletedKey } }, 200);
})
/* ── POST /api/inspections/:id/inspector-signature ────────────────────────── */
    .openapi(createRoute(withMcpMetadata({
    method: 'post',
    path: '/{id}/inspector-signature',
    tags: ["inspections"],
    summary: 'Record inspector signature on an inspection (authenticated)',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
        body: { content: { 'application/json': { schema: InspectorSignatureSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } },
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'),
                        data: z.object({ savedAt: z.number().int().positive().describe('TODO describe savedAt field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration'),
                    }),
                },
            },
            description: 'Saved',
        },
    },
    operationId: "createInspectionInspectorSignature",
    description: "Auto-generated placeholder for createInspectionInspectorSignature (POST /{id}/inspector-signature, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' })), async (c) => {
    const { id } = c.req.valid('param');
    const { signatureBase64, signedAt } = c.req.valid('json');
    const tenantId = c.get('tenantId') as string;
    const db = drizzle(c.env.DB);

    const insp = await db.select().from(inspections)
        .where(and(eq(inspections.id, id), eq(inspections.tenantId, tenantId))).get();
    if (!insp) throw Errors.NotFound('Inspection not found');

    const row = await db.select().from(inspectionResults)
        .where(and(eq(inspectionResults.inspectionId, id), eq(inspectionResults.tenantId, tenantId))).get();
    const data = (row?.data as Record<string, unknown>) ?? {};
    data['_inspector_signature'] = { signatureBase64, signedAt, updatedAt: signedAt };

    if (row) {
        await db.update(inspectionResults)
            .set({ data: data as object, lastSyncedAt: new Date() })
            .where(eq(inspectionResults.id, row.id));
    } else {
        await db.insert(inspectionResults).values({
            id: crypto.randomUUID(),
            tenantId,
            inspectionId: id,
            data: data as object,
            lastSyncedAt: new Date(),
        });
    }

    return c.json({ success: true as const, data: { savedAt: signedAt } }, 200);
})
/* ── POST /api/inspections/:id/template/upgrade ───────────────────────────── */
    .openapi(createRoute(withMcpMetadata({
    method: 'post',
    path: '/{id}/template/upgrade',
    tags: ["inspections"],
    summary: 'Upgrade inspection template snapshot to current master version',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: { params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
    responses: { 200: { content: { 'application/json': { schema: z.object({ success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'), data: z.object({ from: z.number().describe('TODO describe from field for the OpenInspection MCP integration'), to: z.number().describe('TODO describe to field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration') }) } }, description: 'Upgraded' } },
    operationId: "upgradeInspection",
    description: "Auto-generated placeholder for upgradeInspection (POST /{id}/template/upgrade, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' })), async (c) => {
    const { id } = c.req.valid('param');
    const tenantId = c.get('tenantId') as string;
    const db = drizzle(c.env.DB);

    const insp = await db.select().from(inspections)
        .where(and(eq(inspections.id, id), eq(inspections.tenantId, tenantId))).get();
    if (!insp) throw Errors.NotFound('Inspection not found');
    if (!insp.templateId) throw Errors.BadRequest('Inspection has no master template');

    const tpl = await db.select().from(templates)
        .where(and(eq(templates.id, insp.templateId), eq(templates.tenantId, tenantId))).get();
    if (!tpl) throw Errors.NotFound('Master template not found');

    const fromVersion = insp.templateSnapshotVersion ?? 1;
    if (tpl.version <= fromVersion) {
        return c.json({ success: true as const, data: { from: fromVersion, to: fromVersion } }, 200);
    }

    await db.update(inspections)
        .set({ templateSnapshot: tpl.schema, templateSnapshotVersion: tpl.version })
        .where(eq(inspections.id, id));

    auditFromContext(c, 'inspection.template_upgraded', 'inspection', {
        entityId: id, metadata: { from: fromVersion, to: tpl.version },
    });

    return c.json({ success: true as const, data: { from: fromVersion, to: tpl.version } }, 200);
});

export type InspectionSyncApi = typeof syncRoutes;

export default syncRoutes;
