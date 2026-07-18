import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { drizzle } from 'drizzle-orm/d1';
import { and, eq } from 'drizzle-orm';
import { requireRole } from '../lib/middleware/rbac';
import { Errors } from '../lib/errors';
import { auditFromContext } from '../lib/audit';
import {
    InspectorSignatureSchema,
} from '../lib/validations/sync.schema';
import { inspections, inspectionResults, templates } from '../lib/db/schema';
import { withMcpMetadata } from "../lib/route-metadata-standards";

const syncRoutes = createApiRouter()
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
