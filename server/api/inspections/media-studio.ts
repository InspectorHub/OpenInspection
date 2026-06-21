// Media Studio sub-router: pluggable video backend (Stream or R2) lifecycle +
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
import { logger } from '../../lib/logger';
import { createApiResponseSchema, SuccessResponseSchema } from '../../lib/validations/shared.schema';
import { CoverCropSchema, PhotoCropSchema } from '../../lib/validations/inspection.schema';
import {
    UpdateMediaAnnotationsSchema,
    CreateVideoUploadSchema,
    FinalizeVideoSchema,
    SetPosterSchema,
    VideoRefSchema,
} from '../../lib/validations/media.schema';
import { MediaVideoService } from '../../services/media-video.service';
import { resolveVideoBackend } from '../../services/video/resolve';
import { drizzle } from 'drizzle-orm/d1';
import { inspectionMediaPool } from '../../lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { withMcpMetadata } from '../../lib/route-metadata-standards';
import { registerR2VideoRoutes } from './media-video-r2';

/* ── Plan 7 — video walk-through (pluggable backend) ───────────────────────
 *
 * The router now delegates to a VideoBackend resolved per request. Two
 * concrete implementations exist: StreamVideoBackend (Cloudflare Stream, paid
 * plans) and R2VideoBackend (PHOTOS bucket, free / self-host). Resolution is
 * handled by resolveVideoBackend(c) which reads the deployment mode and tenant
 * plan tier.
 *
 *   POST   /{id}/media/video/create-upload          — mint uploadURL + ref
 *   POST   /{id}/media/video/finalize               — insert the pool row (idempotent)
 *   POST   /{id}/media/video/poster                 — set poster (Stream-only: thumbnailTimestampPct)
 *   DELETE /{id}/media/video/{streamUid}            — delete from backend + drop pool row
 *   POST   /{id}/media/video/r2-upload              — token-gated file PUT to R2 (→ media-video-r2.ts)
 *   POST   /{id}/media/video/r2-upload-poster       — token-gated poster JPEG PUT to R2 (→ media-video-r2.ts)
 *   GET    /{id}/media/video/r2-object/:mediaId     — serve R2 video with Range support (→ media-video-r2.ts)
 *   GET    /{id}/media/video/r2-object/:mediaId/poster — serve R2 poster JPEG (→ media-video-r2.ts)
 *
 * tenantId always comes from the JWT (c.get('tenantId')); the body never
 * carries it.
 */

// ── OpenAPI response schemas ─────────────────────────────────────────────────

export const VideoCreateUploadResponseSchema = z.object({
    uploadURL: z.string().describe('One-shot upload URL (Cloudflare Stream or worker r2-upload endpoint)'),
    provider: z.enum(['stream', 'r2']).describe('Video backend provider selected for this tenant'),
    ref: z.union([
        z.object({ provider: z.literal('stream'), streamUid: z.string() }),
        z.object({ provider: z.literal('r2'), mediaId: z.string(), r2Key: z.string() }),
    ]).describe('Backend-specific video reference — echo this back to finalize'),
}).openapi('VideoCreateUploadResponse');

export const VideoFinalizeResponseSchema = z.object({
    poolId:      z.string().describe('inspection_media_pool row id'),
    streamUid:   z.string().nullable().describe('Cloudflare Stream UID (null for R2 videos)'),
    durationSec: z.number().nullable().describe('Video duration in seconds (null if not yet known)'),
    readyToStream: z.boolean().describe('Whether the video is ready for playback'),
}).openapi('VideoFinalizeResponse');

// ── OpenAPI route definitions ────────────────────────────────────────────────

export const videoCreateUploadRoute = createRoute(withMcpMetadata({
    method: 'post',
    path:   '/{id}/media/video/create-upload',
    tags: ["inspections"],
    summary: 'Mint a video upload URL (Stream or R2 backend)',
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
    description: "Mint a one-shot video upload URL. For paid tenants (SaaS) or stream-mode self-host, returns a Cloudflare Stream direct-creator-upload URL; otherwise returns a worker-proxied R2 upload URL."
}, { scopes: ['write'], tier: 'extended' }));

export const videoFinalizeRoute = createRoute(withMcpMetadata({
    method: 'post',
    path:   '/{id}/media/video/finalize',
    tags: ["inspections"],
    summary: 'Finalize a video upload — insert the media-pool row (idempotent)',
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
    description: "Insert an inspection_media_pool video row after the upload completes. Idempotent. Body is a discriminated VideoRef (stream or r2)."
}, { scopes: ['write'], tier: 'extended' }));

export const videoPosterRoute = createRoute(withMcpMetadata({
    method: 'post',
    path:   '/{id}/media/video/poster',
    tags: ["inspections"],
    summary: 'Set a video poster frame (Stream-only: thumbnailTimestampPct as a 0..1 fraction)',
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
    description: "Set the Cloudflare Stream poster frame and persist posterPct on the pool row. Stream-only — R2 videos use the r2-upload-poster route."
}, { scopes: ['write'], tier: 'extended' }));

export const videoDeleteRoute = createRoute(withMcpMetadata({
    method: 'delete',
    path:   '/{id}/media/video/{streamUid}',
    tags: ["inspections"],
    summary: 'Delete a walk-through video from the backend + drop the pool row',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({
            id:        z.string().uuid().describe('Inspection id'),
            streamUid: z.string().min(1).describe('Stream UID (Stream) or mediaId (R2)'),
        }).describe('Path params'),
    },
    responses: {
        200: {
            content: { 'application/json': { schema: SuccessResponseSchema } },
            description: 'Video deleted',
        },
    },
    operationId: "deleteInspectionVideo",
    description: "Delete a video from the active backend (Cloudflare Stream or R2) and remove its media-pool row. Pass the Stream UID for Stream videos or the mediaId for R2 videos."
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


// ── Route handlers ────────────────────────────────────────────────────────────

const mediaStudioRoutes = createApiRouter()
    .openapi(videoCreateUploadRoute, async (c) => {
        const { id } = c.req.valid('param');
        const tenantId = c.get('tenantId');
        // Ownership check (404 on cross-tenant); tenantId is from the JWT.
        await c.var.services.inspection.getInspection(id, tenantId);

        const { backend, provider } = await resolveVideoBackend(c);
        let out: { uploadURL: string; ref: { provider: 'stream'; streamUid: string } | { provider: 'r2'; mediaId: string; r2Key: string } };
        try {
            out = await backend.createUpload(id);
        } catch (err) {
            // Cloudflare Stream rejects the direct-upload mint when the account has
            // no allocated minutes / Stream isn't provisioned (QuotaReachedError),
            // or on a transient Stream API failure. Translate to a typed 503 so the
            // editor can show WHY rather than a generic 500 the client blames on the
            // inspector's connection. The real Stream error is logged for ops.
            const detail = err instanceof Error ? err.message : String(err);
            logger.error('Video create-upload failed', { inspectionId: id, provider }, err instanceof Error ? err : undefined);
            const isQuota = /quota|capacity|allocated|minutes|storage/i.test(detail);
            throw Errors.ServiceUnavailable(
                isQuota
                    ? 'Video uploads are unavailable — the video service has no remaining storage quota. Ask your administrator to enable Stream or add minutes.'
                    : 'Video uploads are temporarily unavailable. Please try again later, or contact your administrator if it persists.',
            );
        }

        return c.json({
            success: true,
            data: {
                uploadURL: out.uploadURL,
                provider,
                ref: out.ref,
            },
        }, 200);
    })
    .openapi(videoFinalizeRoute, async (c) => {
        const { id } = c.req.valid('param');
        const ref = c.req.valid('json');
        const tenantId = c.get('tenantId');
        await c.var.services.inspection.getInspection(id, tenantId);

        const { backend } = await resolveVideoBackend(c);
        const posterRef = ref.provider === 'r2' && ref.posterKey
            ? { posterKey: ref.posterKey }
            : undefined;

        const { poolId } = await backend.finalize(ref, posterRef);
        const details = await backend.getDetails(ref);

        auditFromContext(c, 'inspection.media.video.finalize', 'inspection', {
            entityId: id,
            metadata: { poolId },
        });

        return c.json({
            success: true,
            data: {
                poolId,
                streamUid: ref.provider === 'stream' ? ref.streamUid : null,
                durationSec: details.durationSec ?? null,
                readyToStream: details.readyToStream,
            },
        }, 200);
    })
    .openapi(videoPosterRoute, async (c) => {
        const { id } = c.req.valid('param');
        const { streamUid, posterPct } = c.req.valid('json');
        const tenantId = c.get('tenantId');
        await c.var.services.inspection.getInspection(id, tenantId);

        // Poster frame is Stream-only — uses MediaVideoService directly since
        // setPoster is not part of the VideoBackend interface (R2 videos use
        // the r2-upload-poster route to store a JPEG poster image instead).
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
        const { id, streamUid: videoRef } = c.req.valid('param');
        const tenantId = c.get('tenantId');
        await c.var.services.inspection.getInspection(id, tenantId);

        const { backend, provider } = await resolveVideoBackend(c);
        const db = drizzle(c.env.DB);

        if (provider === 'stream') {
            await backend.delete({ provider: 'stream', streamUid: videoRef });
        } else {
            // R2: videoRef is the mediaId. Look up the pool row to get r2Key for
            // the delete call (the backend needs the full ref to locate the object).
            const row = await db
                .select({ r2Key: inspectionMediaPool.r2Key })
                .from(inspectionMediaPool)
                .where(and(
                    eq(inspectionMediaPool.id, videoRef),
                    eq(inspectionMediaPool.tenantId, tenantId),
                    eq(inspectionMediaPool.provider, 'r2'),
                ))
                .get();
            if (!row) throw Errors.NotFound('Video not found');
            await backend.delete({ provider: 'r2', mediaId: videoRef, r2Key: row.r2Key });
        }

        auditFromContext(c, 'inspection.media.video.delete', 'inspection', {
            entityId: id,
            metadata: { videoRef },
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

// Register R2 binary routes (upload + Range serve) — split into media-video-r2.ts
// to keep this file under the large-file ceiling.
registerR2VideoRoutes(mediaStudioRoutes);

// VideoRefSchema is re-exported here so callers can import it from the
// stable media-studio entry point rather than reaching into validations/.
export { VideoRefSchema };

export default mediaStudioRoutes;
