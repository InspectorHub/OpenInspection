// Photo/media/video upload, serve, crop, reorder, attach, annotations sub-router.
// Behavior-preserving extraction from inspections.ts — handler bodies are
// byte-identical to the original (only the dynamic-import path depth changed).
import {
    CoverCropSchema,
    Errors,
    MediaVideoService,
    PhotoCropSchema,
    and,
    approveConciergeRoute,
    auditFromContext,
    contentDisposition,
    createApiRouter,
    cropItemPhotoRoute,
    drizzle,
    eq,
    getBaseUrl,
    inspectionMediaPool,
    itemPhotoDetachRoute,
    itemPhotoMoveRoute,
    itemPhotoRevertRoute,
    itemPhotosReorderRoute,
    logger,
    mediaAttachRoute,
    mediaCenterRoute,
    mediaPoolDeleteRoute,
    mediaUploadRoute,
    saveAnnotationRoute,
    servePhotoRoute,
    setCoverCropRoute,
    updateMediaAnnotationsRoute,
    uploadPhotoRoute,
    videoCreateUploadRoute,
    videoDeleteRoute,
    videoFinalizeRoute,
    videoPosterRoute,
} from './_shared';

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
    })
    .openapi(approveConciergeRoute, async (c) => {
        const { id } = c.req.valid('param');
        const tenantId = c.get('tenantId');
        await c.var.services.concierge.approveByInspector(id, tenantId);
        return c.json({ success: true as const }, 200);
    });

export default mediaRoutes;
