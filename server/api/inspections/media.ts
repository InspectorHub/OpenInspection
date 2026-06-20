// Photo upload/serve + media-pool (attach/delete/reorder/detach/revert/move) +
// concierge-approve sub-router. The Cloudflare Stream video lifecycle and the
// crop/annotation derivative bakes live alongside in ./media-studio.ts.
// Behavior-preserving extraction from inspections.ts — handler bodies + route
// definitions are byte-identical to the original (only their location changed).
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { requireRole } from '../../lib/middleware/rbac';
import { auditFromContext } from '../../lib/audit';
import { Errors } from '../../lib/errors';
import { contentDisposition } from '../../lib/content-disposition';
import { logger } from '../../lib/logger';
import { createApiResponseSchema, SuccessResponseSchema } from '../../lib/validations/shared.schema';
import {
    MediaCenterResponseSchema,
    MediaPoolUploadResponseSchema,
    MediaAttachRequestSchema,
    MediaAttachResponseSchema,
    ReorderPhotosSchema,
    ItemPhotoMutationSchema,
    MovePhotoSchema,
} from '../../lib/validations/inspection.schema';
import { withMcpMetadata } from '../../lib/route-metadata-standards';

/**
 * Photo Upload
 *
 * Sprint 1 A-7: accepts optional `targetType` ('item' | 'defect') and
 * `customId` so a photo can be bound to a specific custom defect row
 * instead of the item as a whole. R2 upload + storage logic is unchanged;
 * the response echoes the target so the client can attach the key to the
 * right custom row.
 */
export const uploadPhotoRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/{id}/upload',
    tags: ["inspections"],
    summary: "Upload inspection for current tenant",
    request: {
        params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
        body: {
            content: {
                'multipart/form-data': {
                    schema: z.object({
                        file: z.unknown().openapi({ type: 'string', format: 'binary' }).describe('TODO describe file field for the OpenInspection MCP integration'),
                        itemId: z.string().describe('TODO describe itemId field for the OpenInspection MCP integration'),
                        targetType: z.enum(['item', 'defect']).optional().describe('TODO describe targetType field for the OpenInspection MCP integration'),
                        customId: z.string().optional().describe('TODO describe customId field for the OpenInspection MCP integration'),
                    }).describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
        },
    },
    middleware: [requireRole('owner', 'manager', 'inspector')],
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: createApiResponseSchema(z.object({
                        key: z.string().describe('TODO describe key field for the OpenInspection MCP integration'),
                        targetType: z.enum(['item', 'defect']).describe('TODO describe targetType field for the OpenInspection MCP integration'),
                        itemId: z.string().describe('TODO describe itemId field for the OpenInspection MCP integration'),
                        customId: z.string().nullable().describe('TODO describe customId field for the OpenInspection MCP integration'),
                    })),
                },
            },
            description: 'Success',
        },
    },
    operationId: "uploadInspection",
    description: "Auto-generated placeholder for uploadInspection (POST /{id}/upload, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

/* ── A-9 — Inspection photo serve ─────────────────────────────────────────
 * Item + pool photos are referenced across the editor (SideRail, PhotoStudio)
 * and media center, but no handler existed (every such <img> 404'd). This
 * authenticated route streams the R2 object scoped to the caller's tenant +
 * inspection (via the key prefix) and sets Content-Disposition from the stored
 * original filename (`?download=1` forces an attachment). The R2 key — which
 * contains '/' — travels as a query param to avoid path-segment splitting.
 * The public report viewer has its own token-scoped twin in public-report.ts.
 */
export const servePhotoRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/{id}/photo',
    tags: ["inspections"],
    summary: 'Serve an inspection photo (tenant-scoped)',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({ id: z.string().uuid().describe('Inspection id that scopes the photo.') }),
        query: z.object({
            key: z.string().describe('R2 object key (`${tenantId}/${inspectionId}/...`).'),
            download: z.string().optional().describe('Set to "1" to force an attachment download named after the original file.'),
            w: z.string().optional().describe('Optional max width in pixels for an on-the-fly thumbnail (grid previews); omitted serves the full-resolution original.'),
        }),
    },
    responses: {
        200: { content: { 'image/*': { schema: z.any() } }, description: 'Photo bytes' },
        404: { description: 'Not found' },
    },
    operationId: "serveInspectionPhoto",
    description: "Streams an inspection item/pool photo from R2, scoped to the caller's tenant + inspection via the key prefix. Sets Content-Disposition from the stored original filename; ?download=1 forces an attachment.",
}, { scopes: ['read'], tier: 'extended' }));

/* ── Round-2 backlog #9 (Spectora §E.3) — Media Center ─────────────────────
 *
 * Three endpoints powering the editor's centralized photo library drawer:
 *   GET  /api/inspections/:id/media          — aggregate {attached, pool}
 *   POST /api/inspections/:id/media/upload   — bulk upload to loose pool
 *   POST /api/inspections/:id/media/attach   — attach pool photo to an item
 *   DELETE /api/inspections/:id/media/pool/:poolId — discard pool photo
 */
export const mediaCenterRoute = createRoute(withMcpMetadata({
    method: 'get',
    path:   '/{id}/media',
    tags: ["inspections"],
    summary: 'Media Center — all attached + pool photos',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: { params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
    responses: {
        200: {
            content: { 'application/json': { schema: createApiResponseSchema(MediaCenterResponseSchema) } },
            description: 'Aggregated photos',
        },
    },
    operationId: "listInspectionMedia",
    description: "Auto-generated placeholder for listInspectionMedia (GET /{id}/media, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' }));

export const mediaUploadRoute = createRoute(withMcpMetadata({
    method: 'post',
    path:   '/{id}/media/upload',
    tags: ["inspections"],
    summary: 'Upload a photo to the inspection media pool (loose, unattached)',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
        body: {
            content: {
                'multipart/form-data': {
                    schema: z.object({
                        file:    z.unknown().openapi({ type: 'string', format: 'binary' }).describe('TODO describe file field for the OpenInspection MCP integration'),
                        // Optional EXIF take-time as epoch milliseconds — the
                        // client-side photo picker extracts this when the
                        // browser exposes File.lastModified or an EXIF parser
                        // is available.
                        takenAt: z.coerce.number().int().nonnegative().optional().describe('TODO describe takenAt field for the OpenInspection MCP integration'),
                    }).describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
        },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: createApiResponseSchema(MediaPoolUploadResponseSchema) } },
            description: 'Pool photo created',
        },
    },
    operationId: "uploadInspection",
    description: "Auto-generated placeholder for uploadInspection (POST /{id}/media/upload, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

export const mediaAttachRoute = createRoute(withMcpMetadata({
    method: 'post',
    path:   '/{id}/media/attach',
    tags: ["inspections"],
    summary: 'Attach a pool photo to an inspection item',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
        body: { content: { 'application/json': { schema: MediaAttachRequestSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: createApiResponseSchema(MediaAttachResponseSchema) } },
            description: 'Photo attached',
        },
    },
    operationId: "attachInspection",
    description: "Auto-generated placeholder for attachInspection (POST /{id}/media/attach, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

export const mediaPoolDeleteRoute = createRoute(withMcpMetadata({
    method: 'delete',
    path:   '/{id}/media/pool/{poolId}',
    tags: ["inspections"],
    summary: 'Delete a pool photo (cancel an upload)',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration'), poolId: z.string().min(1).describe('TODO describe poolId field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
    },
    responses: {
        200: {
            content: { 'application/json': { schema: SuccessResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } },
            description: 'Pool photo deleted',
        },
    },
    operationId: "deleteInspectionMediaPool",
    description: "Auto-generated placeholder for deleteInspectionMediaPool (DELETE /{id}/media/pool/{poolId}, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

// Media Studio (Plan 3, P4) — reorder an item's photos[] (array order ==
// report photo order). Pure permutation; the submitted key set must match.
export const itemPhotosReorderRoute = createRoute(withMcpMetadata({
    method: 'post',
    path:   '/{id}/items/{itemId}/photos/reorder',
    tags: ["inspections"],
    summary: 'Reorder an item\'s photos (array order = report order)',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({
            id:     z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration'),
            itemId: z.string().min(1).describe('TODO describe itemId field for the OpenInspection MCP integration'),
        }).describe('TODO describe params field for the OpenInspection MCP integration'),
        body: { content: { 'application/json': { schema: ReorderPhotosSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: SuccessResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } },
            description: 'Photos reordered',
        },
    },
    operationId: "reorderInspectionItemPhotos",
    description: "Auto-generated placeholder for reorderInspectionItemPhotos (POST /{id}/items/{itemId}/photos/reorder, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

// Media Studio (Plan 3, P4) — detach a photo from an item (drop the array
// entry; the R2 object is preserved).
export const itemPhotoDetachRoute = createRoute(withMcpMetadata({
    method: 'post',
    path:   '/{id}/items/{itemId}/photos/{photoIndex}/detach',
    tags: ["inspections"],
    summary: 'Detach a photo from an inspection item (keeps the R2 object)',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({
            id:         z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration'),
            itemId:     z.string().min(1).describe('TODO describe itemId field for the OpenInspection MCP integration'),
            photoIndex: z.coerce.number().int().nonnegative().describe('Index of the photo within the item\'s photos[] array'),
        }).describe('TODO describe params field for the OpenInspection MCP integration'),
        body: { content: { 'application/json': { schema: ItemPhotoMutationSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: SuccessResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } },
            description: 'Photo detached',
        },
    },
    operationId: "detachInspectionItemPhoto",
    description: "Auto-generated placeholder for detachInspectionItemPhoto (POST /{id}/items/{itemId}/photos/{photoIndex}/detach, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

// Media Studio (Plan 3) — revert a photo's edits to the original (drop the
// annotated derivative; keep the source key). Non-destructive undo.
export const itemPhotoRevertRoute = createRoute(withMcpMetadata({
    method: 'post',
    path:   '/{id}/items/{itemId}/photos/{photoIndex}/revert',
    tags: ["inspections"],
    summary: 'Revert a photo\'s edits to the original (drops annotations)',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({
            id:         z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration'),
            itemId:     z.string().min(1).describe('TODO describe itemId field for the OpenInspection MCP integration'),
            photoIndex: z.coerce.number().int().nonnegative().describe('Index of the photo within the item\'s photos[] array'),
        }).describe('TODO describe params field for the OpenInspection MCP integration'),
        body: { content: { 'application/json': { schema: ItemPhotoMutationSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: SuccessResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } },
            description: 'Photo reverted',
        },
    },
    operationId: "revertInspectionItemPhoto",
    description: "Auto-generated placeholder for revertInspectionItemPhoto (POST /{id}/items/{itemId}/photos/{photoIndex}/revert, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

// Media Studio (Plan 3, Task 9b) — move a photo from one item to another
// (detach from source + append to target, derivatives ride along).
export const itemPhotoMoveRoute = createRoute(withMcpMetadata({
    method: 'post',
    path:   '/{id}/items/{itemId}/photos/{photoIndex}/move',
    tags: ["inspections"],
    summary: 'Move a photo from one inspection item to another',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({
            id:         z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration'),
            itemId:     z.string().min(1).describe('TODO describe itemId field for the OpenInspection MCP integration'),
            photoIndex: z.coerce.number().int().nonnegative().describe('Index of the photo within the source item\'s photos[] array'),
        }).describe('TODO describe params field for the OpenInspection MCP integration'),
        body: { content: { 'application/json': { schema: MovePhotoSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: SuccessResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } },
            description: 'Photo moved',
        },
    },
    operationId: "moveInspectionItemPhoto",
    description: "Auto-generated placeholder for moveInspectionItemPhoto (POST /{id}/items/{itemId}/photos/{photoIndex}/move, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

// -----------------------------------------------------------------------------
// Agent Accounts A3 — POST /api/inspections/:id/concierge/approve
// -----------------------------------------------------------------------------
// Inspector flips an awaiting_inspector concierge booking to awaiting_client.
// Service mints the magic-link + sends the client confirm email. Tenant scope
// is enforced via JWT-derived tenantId — never trust the URL for tenant.
export const approveConciergeRoute = createRoute(withMcpMetadata({
    method: 'post',
    path:   '/{id}/concierge/approve',
    tags: ["inspections"],
    summary: 'Approve a concierge booking awaiting inspector review',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
    },
    responses: {
        200: {
            content: { 'application/json': { schema: SuccessResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } },
            description: 'Approved',
        },
        404: { description: 'Inspection not found in this tenant' },
        409: { description: 'Inspection is not in awaiting_inspector state' },
    },
    operationId: "approveInspection",
    description: "Auto-generated placeholder for approveInspection (POST /{id}/concierge/approve, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));


const mediaRoutes = createApiRouter()
    .openapi(uploadPhotoRoute, async (c) => {
        const { id } = c.req.valid('param');
        const formData = await c.req.parseBody();
        const file = formData['file'] as File;
        const itemId = formData['itemId'] as string;
        const targetTypeRaw = formData['targetType'];
        const customIdRaw = formData['customId'];
        const targetType = (targetTypeRaw === 'defect' ? 'defect' : 'item') as 'item' | 'defect';
        const customId = typeof customIdRaw === 'string' && customIdRaw.length > 0 ? customIdRaw : null;

        if (!file || !itemId) throw Errors.BadRequest('File and Item ID are required');
        if (targetType === 'defect' && !customId) throw Errors.BadRequest('customId is required when targetType=defect');

        const service = c.var.services.inspection;
        const key = await service.uploadPhoto(id, c.get('tenantId'), itemId, file);
        return c.json({ success: true, data: { key, targetType, itemId, customId } }, 200);
    })
    .openapi(servePhotoRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const { id } = c.req.valid('param');
        const { key, download, w } = c.req.valid('query');
        if (!c.env.PHOTOS) return c.notFound();
        // Ownership: keys are `${tenantId}/${inspectionId}/...`; reject anything
        // outside this caller's tenant + the inspection in the path.
        if (!key.startsWith(`${tenantId}/${id}/`)) return c.notFound();
        const obj = await c.env.PHOTOS.get(key);
        if (!obj) return c.notFound();

        // DB-16 — optional on-the-fly thumbnail (`?w=`) for grid previews so the
        // browser doesn't download full-resolution originals. Uses the Cloudflare
        // Images binding when available; ANY failure (no binding / no entitlement /
        // non-image) falls back to streaming the original, so it never regresses.
        const width = w ? Math.min(Math.max(parseInt(w, 10) || 0, 16), 2000) : 0;
        const images = (c.env as unknown as { IMAGES?: {
            input(s: ReadableStream): { transform(o: { width: number }): { output(o: { format: string }): Promise<{ response(): Response }> } };
        } }).IMAGES;
        if (width > 0 && images && obj.body) {
            try {
                const out = await images.input(obj.body).transform({ width }).output({ format: 'image/webp' });
                const r = out.response();
                const h = new Headers(r.headers);
                h.set('Cache-Control', 'private, max-age=300');
                return new Response(r.body, { status: 200, headers: h });
            } catch (err) {
                logger.warn('[photo] thumbnail transform failed — serving original', { key, width, error: String(err) });
                // fall through to original below (re-fetch since the stream was consumed)
                const orig = await c.env.PHOTOS.get(key);
                if (orig) {
                    const hh = new Headers();
                    hh.set('Content-Type', orig.httpMetadata?.contentType || 'application/octet-stream');
                    hh.set('Cache-Control', 'private, max-age=300');
                    return new Response(orig.body, { status: 200, headers: hh });
                }
                return c.notFound();
            }
        }

        const headers = new Headers();
        headers.set('Content-Type', obj.httpMetadata?.contentType || 'application/octet-stream');
        headers.set('Content-Disposition', contentDisposition(obj.customMetadata?.originalName, download === '1'));
        headers.set('Cache-Control', 'private, max-age=300');
        if (obj.httpEtag) headers.set('etag', obj.httpEtag);
        return new Response(obj.body, { status: 200, headers });
    })
    .openapi(mediaCenterRoute, async (c) => {
        const { id } = c.req.valid('param');
        const data = await c.var.services.inspection.getMediaCenter(id, c.get('tenantId'));
        return c.json({ success: true, data }, 200);
    })
    .openapi(mediaUploadRoute, async (c) => {
        const { id } = c.req.valid('param');
        const formData = await c.req.parseBody();
        const file = formData['file'] as File;
        const takenAtRaw = formData['takenAt'];
        if (!file) throw Errors.BadRequest('File is required');

        let takenAt: number | null = null;
        if (typeof takenAtRaw === 'string' && takenAtRaw.length > 0) {
            const n = Number(takenAtRaw);
            if (Number.isFinite(n) && n > 0) takenAt = Math.round(n);
        }

        const result = await c.var.services.inspection.uploadPoolPhoto(id, c.get('tenantId'), file, { takenAt });
        return c.json({ success: true, data: result }, 200);
    })
    .openapi(mediaAttachRoute, async (c) => {
        const { id } = c.req.valid('param');
        const { poolId, itemId, sectionId } = c.req.valid('json');
        const result = await c.var.services.inspection.attachPoolPhoto(id, c.get('tenantId'), poolId, itemId, sectionId);
        auditFromContext(c, 'inspection.media.attach', 'inspection', {
            entityId: id,
            metadata: { poolId, itemId, sectionId },
        });
        return c.json({ success: true, data: result }, 200);
    })
    .openapi(mediaPoolDeleteRoute, async (c) => {
        const { id, poolId } = c.req.valid('param');
        await c.var.services.inspection.deletePoolPhoto(id, c.get('tenantId'), poolId);
        return c.json({ success: true as const }, 200);
    })
    .openapi(itemPhotosReorderRoute, async (c) => {
        const { id, itemId } = c.req.valid('param');
        const { order, sectionId } = c.req.valid('json');
        await c.var.services.inspection.reorderItemPhotos(id, c.get('tenantId'), itemId, order, sectionId);
        return c.json({ success: true as const }, 200);
    })
    .openapi(itemPhotoDetachRoute, async (c) => {
        const { id, itemId, photoIndex } = c.req.valid('param');
        const { sectionId } = c.req.valid('json');
        await c.var.services.inspection.detachItemPhoto(id, c.get('tenantId'), itemId, Number(photoIndex), sectionId);
        return c.json({ success: true as const }, 200);
    })
    .openapi(itemPhotoRevertRoute, async (c) => {
        const { id, itemId, photoIndex } = c.req.valid('param');
        const { sectionId } = c.req.valid('json');
        await c.var.services.inspection.revertPhotoEdits(id, c.get('tenantId'), itemId, Number(photoIndex), sectionId);
        return c.json({ success: true as const }, 200);
    })
    .openapi(itemPhotoMoveRoute, async (c) => {
        const { id, itemId, photoIndex } = c.req.valid('param');
        const { toItemId, toSectionId, fromSectionId } = c.req.valid('json');
        await c.var.services.inspection.moveItemPhoto(
            id, c.get('tenantId'), itemId, Number(photoIndex), toItemId, fromSectionId, toSectionId,
        );
        return c.json({ success: true as const }, 200);
    })
    .openapi(approveConciergeRoute, async (c) => {
        const { id } = c.req.valid('param');
        const tenantId = c.get('tenantId');
        await c.var.services.concierge.approveByInspector(id, tenantId);
        return c.json({ success: true as const }, 200);
    });

export default mediaRoutes;
