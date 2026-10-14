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
import { servePhotoObject, imagesBinding } from '../../lib/media/serve-photo';
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
const uploadPhotoRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/{id}/upload',
    tags: ["inspections"],
    summary: "Upload inspection for current tenant",
    request: {
        params: z.object({ id: z.string().trim().min(1).describe('Inspection the photo is stored under.') }),
        body: {
            content: {
                'multipart/form-data': {
                    schema: z.object({
                        file: z.unknown().openapi({ type: 'string', format: 'binary' }).describe('The photo to upload.'),
                        itemId: z.string().describe('Id of the checklist item the photo is for. Required and echoed back, but not used to place the file.'),
                        targetType: z.enum(['item', 'defect']).optional().describe('Whether the photo is for the item itself or for one of its custom defect rows.'),
                        customId: z.string().optional().describe('Id of the custom defect row the photo is for. Required when targetType is defect and echoed back.'),
                    }).describe('Multipart form with the photo file and the item it is meant for.'),
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
    description: "Uploads one photo file (multipart) to the inspection's photo storage and returns its storage key. This route only stores the file: it does not add the photo to any checklist item or to the media pool, so the client must record the returned key itself. itemId must be present but is not used to place the file, and targetType and customId are only validated and echoed back (customId is required when targetType is defect). Location data is stripped from the image where the image service is available. Each call stores a new file. Responds 400 when storage is unavailable or file or itemId is missing. Available to owner, manager and inspector roles."
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
const servePhotoRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/{id}/photo',
    tags: ["inspections"],
    summary: 'Serve an inspection photo (tenant-scoped)',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({ id: z.string().trim().min(1).describe('Inspection id that scopes the photo.') }),
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
const mediaCenterRoute = createRoute(withMcpMetadata({
    method: 'get',
    path:   '/{id}/media',
    tags: ["inspections"],
    summary: 'Media Center — all attached + pool photos',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: { params: z.object({ id: z.string().trim().min(1).describe('Id of the inspection whose photos to list.') }) },
    responses: {
        200: {
            content: { 'application/json': { schema: createApiResponseSchema(MediaCenterResponseSchema) } },
            description: 'Aggregated photos',
        },
    },
    operationId: "listInspectionMedia",
    description: "Returns the photo library of one inspection in two lists. attached holds photos already placed on checklist items or defects, each with its item and section labels (taken from the inspection's own template snapshot, falling back to the item id when there is none), photoIndex, an annotated flag and the original key to revert to. pool holds loose photos uploaded to the inspection but not yet attached to any item, with upload time and optional taken-at time. Not paginated. Returns 404 when the inspection is not in this company. Read-only. Available to owner, manager and inspector roles."
}, { scopes: ['read'], tier: 'extended' }));

const mediaUploadRoute = createRoute(withMcpMetadata({
    method: 'post',
    path:   '/{id}/media/upload',
    tags: ["inspections"],
    summary: 'Upload a photo to the inspection media pool (loose, unattached)',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({ id: z.string().trim().min(1).describe('Inspection the photo is uploaded to.') }),
        body: {
            content: {
                'multipart/form-data': {
                    schema: z.object({
                        file:    z.unknown().openapi({ type: 'string', format: 'binary' }).describe('The photo to add to the media pool.'),
                        // Optional EXIF take-time as epoch milliseconds — the
                        // client-side photo picker extracts this when the
                        // browser exposes File.lastModified or an EXIF parser
                        // is available.
                        takenAt: z.coerce.number().int().nonnegative().optional().describe('When the photo was taken, as Unix milliseconds, if the client can read it from the image. Stored with the pool entry; a missing or non-positive value is treated as unknown.'),
                    }).describe('Multipart form with the photo file and an optional time it was taken.'),
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
    description: "Uploads one photo to the inspection's media pool, the holding area for photos not yet attached to a checklist item, and returns the pool entry with an authenticated URL to view it. The file is stored in photo storage (location data stripped where the image service is available) and a pool row is created; attach it to an item later with the attach route. Each call creates a new entry. Responds 400 when storage is unavailable or the file is missing. Available to owner, manager and inspector roles."
}, { scopes: ['write'], tier: 'extended' }));

const mediaAttachRoute = createRoute(withMcpMetadata({
    method: 'post',
    path:   '/{id}/media/attach',
    tags: ["inspections"],
    summary: 'Attach a pool photo to an inspection item',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({ id: z.string().trim().min(1).describe('Inspection the pool photo and the item belong to.') }),
        body: { content: { 'application/json': { schema: MediaAttachRequestSchema.describe('Which pool photo to attach and which item, optionally within a section, to attach it to.') } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: createApiResponseSchema(MediaAttachResponseSchema) } },
            description: 'Photo attached',
        },
    },
    operationId: "attachInspection",
    description: "Attaches a media pool photo to a checklist item (or to an item within a section), appending it to that item's photo list in the inspection's results. The pool entry is removed as part of the attach, but the stored image file is kept, so the photo then lives only on the item. A results row is created if none exists. Returns the storage key and the new position of the photo in the item's list. Records an inspection.media.attach audit entry. Not idempotent: a repeat fails with 404 because the pool entry is gone. Available to owner, manager and inspector roles."
}, { scopes: ['write'], tier: 'extended' }));

const mediaPoolDeleteRoute = createRoute(withMcpMetadata({
    method: 'delete',
    path:   '/{id}/media/pool/{poolId}',
    tags: ["inspections"],
    summary: 'Delete a pool photo (cancel an upload)',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({ id: z.string().trim().min(1).describe('Inspection the pool photo belongs to.'), poolId: z.string().min(1).describe('Id of the media pool entry to delete.') }),
    },
    responses: {
        200: {
            content: { 'application/json': { schema: SuccessResponseSchema } },
            description: 'Pool photo deleted',
        },
    },
    operationId: "deleteInspectionMediaPool",
    description: "Permanently deletes a photo from the inspection's media pool: both the pool entry and the stored image file (a failed file deletion is logged and ignored). Only unattached pool photos are addressed here; photos already attached to items are removed with the detach route or the item photo delete route. Refused with 409 while the photo is the report cover, so clear the cover first. Responds 404 if the pool entry is not found. Cannot be undone. Available to owner, manager and inspector roles."
}, { scopes: ['write'], tier: 'extended' }));

// Media Studio (Plan 3, P4) — reorder an item's photos[] (array order ==
// report photo order). Pure permutation; the submitted key set must match.
const itemPhotosReorderRoute = createRoute(withMcpMetadata({
    method: 'post',
    path:   '/{id}/items/{itemId}/photos/reorder',
    tags: ["inspections"],
    summary: 'Reorder an item\'s photos (array order = report order)',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({
            id:     z.string().trim().min(1).describe('Inspection the item belongs to.'),
            itemId: z.string().min(1).describe('Id of the checklist item whose photos are reordered.'),
        }),
        body: { content: { 'application/json': { schema: ReorderPhotosSchema.describe('The full list of the item photo keys in the desired order, plus an optional section id.') } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: SuccessResponseSchema } },
            description: 'Photos reordered',
        },
    },
    operationId: "reorderInspectionItemPhotos",
    description: "Sets the order of one checklist item's photos, which is also their order in the report. Send the complete list of the item's current photo keys in the new order: the list must contain exactly the same keys, so photos cannot be added or dropped through it, and a mismatch is rejected. Only the order in the stored results changes. Responds 404 if the inspection has no results yet and 400 if the item has no photos. Available to owner, manager and inspector roles."
}, { scopes: ['write'], tier: 'extended' }));

// Media Studio (Plan 3, P4) — detach a photo from an item (drop the array
// entry; the R2 object is preserved).
const itemPhotoDetachRoute = createRoute(withMcpMetadata({
    method: 'post',
    path:   '/{id}/items/{itemId}/photos/{photoIndex}/detach',
    tags: ["inspections"],
    summary: 'Detach a photo from an inspection item (keeps the R2 object)',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({
            id:         z.string().trim().min(1).describe('Inspection the item belongs to.'),
            itemId:     z.string().min(1).describe('Id of the checklist item the photo is removed from.'),
            photoIndex: z.coerce.number().int().nonnegative().describe('Index of the photo within the item\'s photos[] array'),
        }),
        body: { content: { 'application/json': { schema: ItemPhotoMutationSchema.describe('Optional section id used to locate the item when it is addressed within a section.') } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: SuccessResponseSchema } },
            description: 'Photo detached',
        },
    },
    operationId: "detachInspectionItemPhoto",
    description: "Removes one photo from a checklist item's photo list without deleting the image file, so the file stays in storage. The photo is addressed by its position in the list and later photos shift down by one, so a repeated call removes a different photo. Unlike the item photo delete route this does not delete the file from storage. Responds 404 if the inspection has no results yet and 400 if the item has no photos; an index past the end is rejected. Available to owner, manager and inspector roles."
}, { scopes: ['write'], tier: 'extended' }));

// Media Studio (Plan 3) — revert a photo's edits to the original (drop the
// annotated derivative; keep the source key). Non-destructive undo.
const itemPhotoRevertRoute = createRoute(withMcpMetadata({
    method: 'post',
    path:   '/{id}/items/{itemId}/photos/{photoIndex}/revert',
    tags: ["inspections"],
    summary: 'Revert a photo\'s edits to the original (drops annotations)',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({
            id:         z.string().trim().min(1).describe('Inspection the item belongs to.'),
            itemId:     z.string().min(1).describe('Id of the checklist item whose photo is reverted.'),
            photoIndex: z.coerce.number().int().nonnegative().describe('Index of the photo within the item\'s photos[] array'),
        }),
        body: { content: { 'application/json': { schema: ItemPhotoMutationSchema.describe('Optional section id used to locate the item when it is addressed within a section.') } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: SuccessResponseSchema } },
            description: 'Photo reverted',
        },
    },
    operationId: "revertInspectionItemPhoto",
    description: "Undoes edits on one checklist item photo, returning it to the original image. The photo's entry keeps only its source image key, so the annotated image reference, the stored annotation shapes and any other derived data on that entry are dropped from the results; the derived image files themselves are not deleted from storage. Safe to repeat. Responds 404 if the inspection has no results yet and 400 if the item has no photos; an index past the end is rejected. Available to owner, manager and inspector roles."
}, { scopes: ['write'], tier: 'extended' }));

// Media Studio (Plan 3, Task 9b) — move a photo from one item to another
// (detach from source + append to target, derivatives ride along).
const itemPhotoMoveRoute = createRoute(withMcpMetadata({
    method: 'post',
    path:   '/{id}/items/{itemId}/photos/{photoIndex}/move',
    tags: ["inspections"],
    summary: 'Move a photo from one inspection item to another',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({
            id:         z.string().trim().min(1).describe('Inspection both items belong to.'),
            itemId:     z.string().min(1).describe('Id of the source checklist item the photo is taken from.'),
            photoIndex: z.coerce.number().int().nonnegative().describe('Index of the photo within the source item\'s photos[] array'),
        }),
        body: { content: { 'application/json': { schema: MovePhotoSchema.describe('The target item, plus optional section ids for the source and target items.') } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: SuccessResponseSchema } },
            description: 'Photo moved',
        },
    },
    operationId: "moveInspectionItemPhoto",
    description: "Moves one photo from a checklist item to the end of another item's photo list within the same inspection, keeping its annotated or cropped versions with it. The photo is addressed by its position in the source list, and later photos in that list shift down by one. Section ids are only needed when the items are addressed within a section. Responds 404 if the inspection has no results yet and 400 if the source item has no photos; an index past the end is rejected. Available to owner, manager and inspector roles."
}, { scopes: ['write'], tier: 'extended' }));

// -----------------------------------------------------------------------------
// Agent Accounts A3 — POST /api/inspections/:id/concierge/approve
// -----------------------------------------------------------------------------
// Inspector flips an awaiting_inspector concierge booking to awaiting_client.
// Service mints the magic-link + sends the client confirm email. Tenant scope
// is enforced via JWT-derived tenantId — never trust the URL for tenant.
const approveConciergeRoute = createRoute(withMcpMetadata({
    method: 'post',
    path:   '/{id}/concierge/approve',
    tags: ["inspections"],
    summary: 'Approve a concierge booking awaiting inspector review',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({ id: z.string().trim().min(1).describe('Concierge inspection awaiting approval.') }),
    },
    responses: {
        200: {
            content: { 'application/json': { schema: SuccessResponseSchema } },
            description: 'Approved',
        },
        404: { description: 'Inspection not found in this tenant' },
        409: { description: 'Inspection is not in awaiting_inspector state' },
    },
    operationId: "approveInspection",
    description: "Approves a concierge booking that is waiting for inspector review. The booking moves from awaiting inspector to awaiting client, a confirmation link is created, and the client is emailed that link so they can confirm the appointment. Responds 409 if the booking is not currently awaiting inspector approval, 400 if the inspection has no client email on file, and 404 if the inspection does not exist. Not idempotent: a second call fails with 409. Available to owner, manager and inspector roles."
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
        // Ownership: keys are `${tenantId}/${inspectionId}/...`; reject anything
        // outside this caller's tenant + the inspection in the path.
        if (!key.startsWith(`${tenantId}/inspections/${id}/`)) return c.notFound();
        // DB-16 — `?w=` asks for an on-the-fly thumbnail so grid previews don't
        // download full-resolution originals.
        const res = await servePhotoObject(c.env.PHOTOS, imagesBinding(c.env), key, {
            width: w,
            download: download === '1',
        });
        return res ?? c.notFound();
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
