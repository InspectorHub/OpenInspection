// Media Studio sub-router: Cloudflare Stream walk-through video lifecycle +
// PhotoStudio annotation/crop derivative bakes (annotations, cover crop,
// item/defect photo crop). Split out of media.ts to keep both files under the
// size ceiling. Behavior-preserving extraction from inspections.ts — handler
// bodies + route definitions are byte-identical to the original.
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { requireRole } from '../../lib/middleware/rbac';
import { auditFromContext } from '../../lib/audit';
import { getBaseUrl } from '../../lib/url';
import { Errors } from '../../lib/errors';
import { createApiResponseSchema, SuccessResponseSchema } from '../../lib/validations/shared.schema';
import { CoverCropSchema, PhotoCropSchema } from '../../lib/validations/inspection.schema';
import { UpdateMediaAnnotationsSchema, CreateVideoUploadSchema, FinalizeVideoSchema, SetPosterSchema } from '../../lib/validations/media.schema';
import { MediaVideoService } from '../../services/media-video.service';
import { drizzle } from 'drizzle-orm/d1';
import { inspectionMediaPool } from '../../lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { withMcpMetadata } from '../../lib/route-metadata-standards';

/* ── Plan 7 — video walk-through (Cloudflare Stream) ───────────────────────
 *
 * Direct creator upload: the worker mints a one-shot uploadURL, the browser
 * POSTs the file straight to Cloudflare (bytes bypass the worker → no GPS
 * leak path; Stream re-transcodes and strips container metadata on ingest).
 *   POST   /{id}/media/video/create-upload  — mint uploadURL + streamUid
 *   POST   /{id}/media/video/finalize       — insert the pool row (idempotent)
 *   POST   /{id}/media/video/poster         — set poster frame (thumbnailTimestampPct)
 *   DELETE /{id}/media/video/{streamUid}    — delete from Stream + drop pool row
 *
 * tenantId always comes from the JWT (c.get('tenantId')); the body never
 * carries it. Stream ownership is re-asserted from the meta envelope in the
 * service (fail closed) since videos are not D1 rows with a tenant filter.
 */
export const VideoCreateUploadResponseSchema = z.object({
    uploadURL: z.string().describe('One-shot Cloudflare Stream direct-creator-upload URL'),
    streamUid: z.string().describe('Cloudflare Stream UID for the pending video'),
}).openapi('VideoCreateUploadResponse');

export const VideoFinalizeResponseSchema = z.object({
    poolId:      z.string().describe('inspection_media_pool row id'),
    streamUid:   z.string().describe('Cloudflare Stream UID'),
    durationSec: z.number().nullable().describe('Video duration in seconds (null if not yet known)'),
    readyToStream: z.boolean().describe('Whether Stream has finished transcoding'),
}).openapi('VideoFinalizeResponse');

export const videoCreateUploadRoute = createRoute(withMcpMetadata({
    method: 'post',
    path:   '/{id}/media/video/create-upload',
    tags: ["inspections"],
    summary: 'Mint a Cloudflare Stream direct-creator-upload URL for a walk-through video',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({ id: z.string().uuid().describe('Inspection id') }).describe('Path params'),
        body: { content: { 'application/json': { schema: CreateVideoUploadSchema } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: createApiResponseSchema(VideoCreateUploadResponseSchema) } },
            description: 'Upload URL minted',
        },
    },
    operationId: "createInspectionVideoUpload",
    description: "Mint a one-shot Cloudflare Stream direct-creator-upload URL (browser uploads bytes directly; worker never sees them)."
}, { scopes: ['write'], tier: 'extended' }));

export const videoFinalizeRoute = createRoute(withMcpMetadata({
    method: 'post',
    path:   '/{id}/media/video/finalize',
    tags: ["inspections"],
    summary: 'Finalize a video upload — insert the media-pool row (idempotent on streamUid)',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({ id: z.string().uuid().describe('Inspection id') }).describe('Path params'),
        body: { content: { 'application/json': { schema: FinalizeVideoSchema } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: createApiResponseSchema(VideoFinalizeResponseSchema) } },
            description: 'Pool video row created',
        },
    },
    operationId: "finalizeInspectionVideo",
    description: "Insert an inspection_media_pool video row after the browser-direct upload completes. Idempotent on streamUid."
}, { scopes: ['write'], tier: 'extended' }));

export const videoPosterRoute = createRoute(withMcpMetadata({
    method: 'post',
    path:   '/{id}/media/video/poster',
    tags: ["inspections"],
    summary: 'Set a video poster frame (thumbnailTimestampPct as a 0..1 fraction)',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({ id: z.string().uuid().describe('Inspection id') }).describe('Path params'),
        body: { content: { 'application/json': { schema: SetPosterSchema } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: SuccessResponseSchema } },
            description: 'Poster set',
        },
    },
    operationId: "setInspectionVideoPoster",
    description: "Set the Cloudflare Stream poster frame and persist posterPct on the pool row."
}, { scopes: ['write'], tier: 'extended' }));

export const videoDeleteRoute = createRoute(withMcpMetadata({
    method: 'delete',
    path:   '/{id}/media/video/{streamUid}',
    tags: ["inspections"],
    summary: 'Delete a walk-through video from Cloudflare Stream + drop the pool row',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({
            id:        z.string().uuid().describe('Inspection id'),
            streamUid: z.string().min(1).describe('Cloudflare Stream UID'),
        }).describe('Path params'),
    },
    responses: {
        200: {
            content: { 'application/json': { schema: SuccessResponseSchema } },
            description: 'Video deleted',
        },
    },
    operationId: "deleteInspectionVideo",
    description: "Delete a video from Cloudflare Stream (tenant-guarded via meta envelope) and remove its media-pool row."
}, { scopes: ['write'], tier: 'extended' }));

// Design System 0520 M14 — PhotoStudio annotation save (subsystem A, phase 4).
// Opaque JSON-encoded shape array (≤8 KB) + caption (≤200 chars). Tenant-
// isolated via ScopedDB; 404 on cross-tenant access (no enumeration leak).
export const updateMediaAnnotationsRoute = createRoute(withMcpMetadata({
    method:     'put',
    path:       '/{id}/media/{mediaId}/annotations',
    tags: ["inspections"],
    summary:    'Save PhotoStudio annotation overlay + caption',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({ id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration'), mediaId: z.string().min(1).describe('TODO describe mediaId field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
        body: {
            content: {
                'application/json': {
                    schema: UpdateMediaAnnotationsSchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
        },
    },
    responses: {
        200: {
            description: 'Annotations saved',
            content: {
                'application/json': {
                    schema: z.object({
                        success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'),
                        data: z.object({
                            id:          z.string().describe('TODO describe id field for the OpenInspection MCP integration'),
                            annotations: z.string().nullable().describe('TODO describe annotations field for the OpenInspection MCP integration'),
                            caption:     z.string().nullable().describe('TODO describe caption field for the OpenInspection MCP integration'),
                            updatedAt:   z.number().describe('TODO describe updatedAt field for the OpenInspection MCP integration'),
                        }).describe('TODO describe data field for the OpenInspection MCP integration'),
                    }),
                },
            },
        },
        404: { description: 'Media not found in this tenant' },
    },
    operationId: "updateInspectionMediaAnnotation",
    description: "Auto-generated placeholder for updateInspectionMediaAnnotation (PUT /{id}/media/{mediaId}/annotations, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

// ── Phase T (T12): Photo annotation save ────────────────────────────────────────
export const saveAnnotationRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/{id}/items/{itemId}/photos/{photoIndex}/annotation',
    tags: ["inspections"],
    summary: 'Save photo annotation (composite PNG + Konva nodes JSON)',
    request: {
        params: z.object({
            id: z.string().describe('TODO describe id field for the OpenInspection MCP integration'),
            itemId: z.string().describe('TODO describe itemId field for the OpenInspection MCP integration'),
            photoIndex: z.coerce.number().int().min(0).describe('TODO describe photoIndex field for the OpenInspection MCP integration'),
        }).describe('TODO describe params field for the OpenInspection MCP integration'),
        body: {
            content: {
                'multipart/form-data': {
                    schema: z.object({
                        image: z.unknown().openapi({ type: 'string', format: 'binary' }).describe('TODO describe image field for the OpenInspection MCP integration'),
                        nodes: z.string().describe('TODO describe nodes field for the OpenInspection MCP integration'),
                        sectionId: z.string().optional().describe('Section ID for composite finding key'),
                    }).describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
        },
    },
    middleware: [requireRole('owner', 'manager', 'inspector')],
    responses: {
        200: {
            content: { 'application/json': { schema: createApiResponseSchema(z.object({ annotatedKey: z.string().describe('TODO describe annotatedKey field for the OpenInspection MCP integration') })) } },
            description: 'Annotation saved',
        },
    },
    operationId: "createInspectionItemsPhotosAnnotation",
    description: "Auto-generated placeholder for createInspectionItemsPhotosAnnotation (POST /{id}/items/{itemId}/photos/{photoIndex}/annotation, inspections domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

// ── Media Studio (cover crop): POST /api/inspections/:id/cover ───────────────
// Bakes a cropped JPEG derivative of the chosen cover source photo to R2 and
// records the re-editable crop transform. Mirrors the annotation save shape.
export const setCoverCropRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/{id}/cover',
    tags: ["inspections"],
    summary: 'Set cropped report cover (baked JPEG derivative + crop transform)',
    request: {
        params: z.object({
            id: z.string().describe('Inspection id'),
        }).describe('Cover crop path params'),
        body: {
            content: {
                'multipart/form-data': {
                    schema: z.object({
                        image: z.unknown().openapi({ type: 'string', format: 'binary' }).describe('Baked cropped JPEG (2048px long edge)'),
                        sourceKey: z.string().describe('R2 key of the cover source photo this crop applies to'),
                        crop: z.string().describe('JSON-encoded CoverCrop transform (source-pixel coords)'),
                    }).describe('Cover crop multipart body'),
                },
            },
        },
    },
    middleware: [requireRole('owner', 'manager', 'inspector')],
    responses: {
        200: {
            content: { 'application/json': { schema: createApiResponseSchema(z.object({ coverImageKey: z.string().describe('R2 key of the baked cropped cover derivative') })) } },
            description: 'Cropped cover saved',
        },
    },
    operationId: "setInspectionCover",
    description: "Bake and store a cropped report-cover JPEG derivative for an inspection and record its re-editable crop transform (POST /{id}/cover, inspections domain)."
}, { scopes: ['write'], tier: 'extended' }));

// ── Media Studio (Plan 4): crop an item/defect photo ─────────────────────────
export const cropItemPhotoRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/{id}/items/{itemId}/photos/{photoIndex}/crop',
    tags: ["inspections"],
    summary: 'Bake and store a cropped derivative for an inspection-item or defect photo',
    request: {
        params: z.object({
            id: z.string().describe('Inspection id'),
            itemId: z.string().describe('Inspection item id'),
            photoIndex: z.coerce.number().int().min(0).describe('Index into the item/defect photos array'),
        }).describe('Crop item-photo path params'),
        body: {
            content: {
                'multipart/form-data': {
                    schema: z.object({
                        image: z.unknown().openapi({ type: 'string', format: 'binary' }).describe('Baked cropped JPEG (2048px long edge)'),
                        crop: z.string().describe('JSON-encoded PhotoCrop transform (source-pixel coords)'),
                        sectionId: z.string().optional().describe('Section id for composite finding key (defect photos)'),
                    }).describe('Crop item-photo multipart body'),
                },
            },
        },
    },
    middleware: [requireRole('owner', 'manager', 'inspector')],
    responses: {
        200: {
            content: { 'application/json': { schema: createApiResponseSchema(z.object({ croppedKey: z.string().describe('R2 key of the baked cropped derivative') })) } },
            description: 'Cropped item photo saved',
        },
    },
    operationId: "cropInspectionItemPhoto",
    description: "Bake and store a cropped derivative for an inspection-item or per-defect photo and record its re-editable crop transform (POST /{id}/items/{itemId}/photos/{photoIndex}/crop, inspections domain).",
}, { scopes: ['write'], tier: 'extended' }));


const mediaStudioRoutes = createApiRouter()
    .openapi(videoCreateUploadRoute, async (c) => {
        const { id } = c.req.valid('param');
        const tenantId = c.get('tenantId');
        // Ownership check (404 on cross-tenant); tenantId is from the JWT.
        await c.var.services.inspection.getInspection(id, tenantId);
        const svc = new MediaVideoService(c.env.STREAM, tenantId, getBaseUrl(c));
        const out = await svc.createUpload(id);
        return c.json({ success: true, data: out }, 200);
    })
    .openapi(videoFinalizeRoute, async (c) => {
        const { id } = c.req.valid('param');
        const { streamUid } = c.req.valid('json');
        const tenantId = c.get('tenantId');
        await c.var.services.inspection.getInspection(id, tenantId);

        const svc = new MediaVideoService(c.env.STREAM, tenantId, getBaseUrl(c));
        // Tenant-guarded read of the Stream meta envelope (fail closed).
        const details = await svc.getDetails(streamUid);
        const durationSec = Number.isFinite(details.duration) && details.duration > 0
            ? Math.round(details.duration)
            : null;

        const db = drizzle(c.env.DB);
        // Idempotent on streamUid: a retry must not create a duplicate pool row.
        const existing = await db.select({ id: inspectionMediaPool.id })
            .from(inspectionMediaPool)
            .where(and(eq(inspectionMediaPool.streamUid, streamUid), eq(inspectionMediaPool.tenantId, tenantId)))
            .get();

        let poolId: string;
        if (existing) {
            poolId = existing.id;
            await db.update(inspectionMediaPool)
                .set({ durationSec })
                .where(and(eq(inspectionMediaPool.id, poolId), eq(inspectionMediaPool.tenantId, tenantId)));
        } else {
            poolId = crypto.randomUUID();
            await db.insert(inspectionMediaPool).values({
                id: poolId,
                inspectionId: id,
                tenantId,
                r2Key: '',     // video bytes live in Cloudflare Stream, not R2
                url: '',       // playback URL is derived from streamUid client-side
                uploadedAt: Date.now(),
                mediaType: 'video',
                streamUid,
                durationSec,
            });
        }

        auditFromContext(c, 'inspection.media.video.finalize', 'inspection', {
            entityId: id,
            metadata: { streamUid, poolId },
        });

        return c.json({
            success: true,
            data: { poolId, streamUid, durationSec, readyToStream: details.readyToStream },
        }, 200);
    })
    .openapi(videoPosterRoute, async (c) => {
        const { id } = c.req.valid('param');
        const { streamUid, posterPct } = c.req.valid('json');
        const tenantId = c.get('tenantId');
        await c.var.services.inspection.getInspection(id, tenantId);

        const svc = new MediaVideoService(c.env.STREAM, tenantId, getBaseUrl(c));
        await svc.setPoster(streamUid, posterPct);

        // Persist posterPct on the pool row (best-effort; the Stream side is the
        // source of truth for the rendered thumbnail).
        const db = drizzle(c.env.DB);
        await db.update(inspectionMediaPool)
            .set({ posterPct })
            .where(and(eq(inspectionMediaPool.streamUid, streamUid), eq(inspectionMediaPool.tenantId, tenantId)));

        return c.json({ success: true as const }, 200);
    })
    .openapi(videoDeleteRoute, async (c) => {
        const { id, streamUid } = c.req.valid('param');
        const tenantId = c.get('tenantId');
        await c.var.services.inspection.getInspection(id, tenantId);

        const svc = new MediaVideoService(c.env.STREAM, tenantId, getBaseUrl(c));
        // Tenant-guarded delete (fail closed on meta mismatch).
        await svc.deleteVideo(streamUid);

        const db = drizzle(c.env.DB);
        await db.delete(inspectionMediaPool)
            .where(and(eq(inspectionMediaPool.streamUid, streamUid), eq(inspectionMediaPool.tenantId, tenantId)));

        auditFromContext(c, 'inspection.media.video.delete', 'inspection', {
            entityId: id,
            metadata: { streamUid },
        });

        return c.json({ success: true as const }, 200);
    })
    .openapi(updateMediaAnnotationsRoute, async (c) => {
        const { id, mediaId } = c.req.valid('param');
        const { annotations, caption } = c.req.valid('json');

        const out = await c.var.services.inspection.updateMediaAnnotations(
            id,
            mediaId,
            c.get('tenantId'),
            annotations,
            caption,
        );

        if (!out) {
            throw Errors.NotFound('Media not found');
        }

        return c.json({ success: true as const, data: out }, 200);
    })
    .openapi(saveAnnotationRoute, async (c) => {
        const { id, itemId, photoIndex } = c.req.valid('param');
        const tenantId = c.get('tenantId');
        const formData = await c.req.parseBody();
        const file = formData['image'] as File | undefined;
        const nodesJson = String(formData['nodes'] ?? '[]');
        const sectionId = typeof formData['sectionId'] === 'string' && formData['sectionId'].length > 0
            ? formData['sectionId']
            : undefined;
        if (!file) throw Errors.BadRequest('image file required');
        const bytes = await file.arrayBuffer();
        const result = await c.var.services.inspection.saveAnnotation(
            id, tenantId, itemId, photoIndex, bytes, nodesJson, sectionId,
        );
        return c.json({ success: true, data: result }, 200);
    })
    .openapi(setCoverCropRoute, async (c) => {
        const { id } = c.req.valid('param');
        const tenantId = c.get('tenantId');
        const formData = await c.req.parseBody();
        const file = formData['image'] as File | undefined;
        if (!file) throw Errors.BadRequest('image file required');
        let rawCrop: unknown;
        try { rawCrop = JSON.parse(String(formData['crop'] ?? '{}')); }
        catch { throw Errors.BadRequest('invalid crop'); }
        const parsed = CoverCropSchema.safeParse(rawCrop);
        if (!parsed.success) throw Errors.BadRequest('invalid crop');
        const sourceKey = String(formData['sourceKey'] ?? '');
        const bytes = await file.arrayBuffer();
        const result = await c.var.services.inspection.setCroppedCover(id, tenantId, sourceKey, bytes, parsed.data);
        return c.json({ success: true, data: result }, 200);
    })
    .openapi(cropItemPhotoRoute, async (c) => {
        const { id, itemId, photoIndex } = c.req.valid('param');
        const tenantId = c.get('tenantId');
        const formData = await c.req.parseBody();
        const file = formData['image'] as File | undefined;
        if (!file) throw Errors.BadRequest('image file required');
        let rawCrop: unknown;
        try { rawCrop = JSON.parse(String(formData['crop'] ?? '{}')); }
        catch { throw Errors.BadRequest('invalid crop'); }
        const parsed = PhotoCropSchema.safeParse(rawCrop);
        if (!parsed.success) throw Errors.BadRequest('invalid crop');
        const sectionId = typeof formData['sectionId'] === 'string' && formData['sectionId'].length > 0
            ? formData['sectionId'] : undefined;
        const bytes = await file.arrayBuffer();
        const result = await c.var.services.inspection.saveCroppedItemPhoto(
            id, tenantId, itemId, photoIndex, bytes, parsed.data, sectionId,
        );
        return c.json({ success: true, data: result }, 200);
    });

export default mediaStudioRoutes;
