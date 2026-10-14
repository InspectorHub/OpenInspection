import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { and, eq } from 'drizzle-orm';
import { requireRole } from '../lib/middleware/rbac';
import { Errors } from '../lib/errors';
import { auditFromContext } from '../lib/audit';
import {
    InspectorSignatureSchema,
} from '../lib/validations/sync.schema';
import { inspections, inspectionResults, templates } from '../lib/db/schema';
import { withMcpMetadata } from "../lib/route-metadata-standards";
import { getDrizzle } from '../lib/route-helpers';
import { resolvePrimaryReportId } from '../lib/inspection/reports';
import { r2Delete } from '../lib/r2/objects';
import type { DrizzleD1Database } from 'drizzle-orm/d1';

/**
 * The results row a FIELD write belongs to, and the report it is a row of.
 *
 * An order now carries one results row per REPORT — `uq_results_report` is
 * unique on `report_id`, and the standard report and the sewer report each own
 * their own findings. So "the inspection's results" stopped naming a row:
 * selecting on `inspection_id` alone returns whichever the scan reaches first,
 * which is a coin toss between two documents. The editor's Durable Object was
 * already converted ("per REPORT when we know which one"); these routes were
 * not, and they are the ones the field uses — a signature captured offline and
 * a photo deleted on site.
 *
 * They are addressed by INSPECTION and the offline client holds no report id,
 * so the primary report is the answer, resolved the way the collab route
 * resolves it. Failing closed matters more here than anywhere: the insert path
 * below used to write a row with a NULL `report_id`, and because the unique
 * index is on a nullable column nothing complained — the row simply became
 * invisible to every report-scoped read.
 */
async function primaryResults(
    db: DrizzleD1Database,
    tenantId: string,
    inspectionId: string,
): Promise<{ reportId: string; row: typeof inspectionResults.$inferSelect | undefined }> {
    const reportId = await resolvePrimaryReportId(db, tenantId, inspectionId);
    if (!reportId) throw Errors.NotFound('Inspection has no primary report');
    const row = await db.select().from(inspectionResults)
        .where(and(
            eq(inspectionResults.tenantId, tenantId),
            eq(inspectionResults.reportId, reportId),
        )).get();
    return { reportId, row };
}

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
            id:         z.string().trim().min(1).describe('Inspection id.'),
            itemId:     z.string().describe('Id of the checklist item whose photo list is edited, as it appears in the results data.'),
            photoIndex: z.coerce.number().int().nonnegative().describe('Zero-based position of the photo within the item photo list.'),
        }),
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.literal(true).describe('Always true when the photo was removed.'),
                        data: z.object({ deletedKey: z.string().nullable().describe('Result of the photo removal.') }).describe('Result of the photo removal.'),
                    }),
                },
            },
            description: 'Deleted',
        },
    },
    operationId: "deleteInspectionItemsPhoto",
    description: "Removes one photo from a checklist item on the inspection's primary report, addressed by its position in that item's photo list. The entry is taken out of the stored results, and the underlying file is then deleted from photo storage on a best-effort basis (a storage failure is ignored, so the entry can disappear while the file lingers). Returns the storage key of the removed photo, or null if the entry had none. Because later photos shift down by one, repeating the same call removes a different photo and index values from before a delete are stale afterwards. Responds 404 when the inspection has no primary report or results, or the index is past the end of the item's photos. Does not write an audit record. Available to owner, manager and inspector roles."
}, { scopes: ['write'], tier: 'extended' })), async (c) => {
    const { id, itemId, photoIndex } = c.req.valid('param');
    const tenantId = c.get('tenantId') as string;
    const db = getDrizzle(c);

    const insp = await db.select().from(inspections)
        .where(and(eq(inspections.id, id), eq(inspections.tenantId, tenantId))).get();
    if (!insp) throw Errors.NotFound('Inspection not found');

    const { row } = await primaryResults(db, tenantId, id);
    if (!row) throw Errors.NotFound('Results not found');

    const data = row.data as Record<string, { photos?: Array<{ key: string }> }>;
    const photos = data[itemId]?.photos ?? [];
    if (photoIndex >= photos.length) throw Errors.NotFound('Photo index out of range');

    const deletedKey = photos[photoIndex]?.key ?? null;
    photos.splice(photoIndex, 1);

    await db.update(inspectionResults)
        .set({ data: data as unknown as object, lastSyncedAt: new Date() })
        .where(and(
            eq(inspectionResults.tenantId, tenantId),
            eq(inspectionResults.id, row.id),
        ));

    if (deletedKey && c.env.PHOTOS) {
        await r2Delete(c.env.PHOTOS, deletedKey).catch(() => {});
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
        params: z.object({ id: z.string().trim().min(1).describe('Inspection id.') }),
        body: { content: { 'application/json': { schema: InspectorSignatureSchema.describe('The signature image and the time the inspector signed.') } } },
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.literal(true).describe('Always true when the signature was recorded.'),
                        data: z.object({ savedAt: z.number().int().positive().describe('Result of recording the inspector signature.') }).describe('Result of recording the inspector signature.'),
                    }),
                },
            },
            description: 'Saved',
        },
    },
    operationId: "createInspectionInspectorSignature",
    description: "Stores the inspector's drawn signature image on the inspection's primary report. It is saved inside that report's results data, replacing any signature saved earlier, and a results row is created if the report has none yet. Safe to repeat: the last call wins. savedAt in the response simply echoes the signedAt the client sent, not a server time. Responds 404 if the inspection or its primary report is missing. Does not email anyone or write an audit record. Available to owner, manager and inspector roles."
}, { scopes: ['write'], tier: 'extended' })), async (c) => {
    const { id } = c.req.valid('param');
    const { signatureBase64, signedAt } = c.req.valid('json');
    const tenantId = c.get('tenantId') as string;
    const db = getDrizzle(c);

    const insp = await db.select().from(inspections)
        .where(and(eq(inspections.id, id), eq(inspections.tenantId, tenantId))).get();
    if (!insp) throw Errors.NotFound('Inspection not found');

    const { reportId, row } = await primaryResults(db, tenantId, id);
    const data = (row?.data as Record<string, unknown>) ?? {};
    data['_inspector_signature'] = { signatureBase64, signedAt, updatedAt: signedAt };

    if (row) {
        await db.update(inspectionResults)
            .set({ data: data as object, lastSyncedAt: new Date() })
            .where(and(eq(inspectionResults.tenantId, tenantId), eq(inspectionResults.id, row.id)));
    } else {
        await db.insert(inspectionResults).values({
            id: crypto.randomUUID(),
            tenantId,
            inspectionId: id,
            // Bound at creation. A results row with no report belongs to no
            // deliverable and is read by nothing.
            reportId,
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
    request: { params: z.object({ id: z.string().trim().min(1).describe('Inspection id.') }) },
    responses: { 200: { content: { 'application/json': { schema: z.object({ success: z.literal(true).describe('Always true when the upgrade check completed.'), data: z.object({ from: z.number().describe('Template snapshot version the inspection was on before this call.'), to: z.number().describe('Template snapshot version the inspection is on after this call; equal to from when it was already current.') }).describe('Versions before and after the snapshot upgrade.') }) } }, description: 'Upgraded' } },
    operationId: "upgradeInspection",
    description: "Brings the inspection's frozen copy of its template up to the current version of the master template it was created from. When the master has a newer version, its current schema replaces the inspection's snapshot and the snapshot version is updated, and an inspection.template_upgraded audit record is written. When the snapshot is already current nothing changes and from equals to. Results already entered are not touched by this route. Responds 400 if the inspection has no master template and 404 if the inspection or the master template no longer exists. Available to owner, manager and inspector roles."
}, { scopes: ['write'], tier: 'extended' })), async (c) => {
    const { id } = c.req.valid('param');
    const tenantId = c.get('tenantId') as string;
    const db = getDrizzle(c);

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
        .where(and(
            eq(inspections.tenantId, tenantId),
            eq(inspections.id, id),
        ));

    auditFromContext(c, 'inspection.template_upgraded', 'inspection', {
        entityId: id, metadata: { from: fromVersion, to: tpl.version },
    });

    return c.json({ success: true as const, data: { from: fromVersion, to: tpl.version } }, 200);
});

export type InspectionSyncApi = typeof syncRoutes;

export default syncRoutes;
