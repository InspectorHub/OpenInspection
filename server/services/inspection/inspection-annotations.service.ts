import { eq, and } from 'drizzle-orm';
import { inspections, inspectionResults, inspectionMediaPool } from '../../lib/db/schema';
import { Errors } from '../../lib/errors';
import { findingKey, DEFAULT_UNIT } from '../../lib/finding-key';
import { type CoverCrop, type PhotoCrop } from '../../lib/validations/inspection.schema';
import type { PhotoEntry } from '../../lib/media/collect-attached';
import type { ScopedDB } from '../../lib/db/scoped';
import type { ImagesBinding } from '../../lib/media/strip-exif';
import { InspectionSubService } from './base';
import type { InspectionService } from '../inspection.service';

/**
 * Media annotation + crop derivative writes: PhotoStudio annotation save,
 * media-pool annotation/caption edit, cover crop bake, and item-photo crop
 * bake. Extracted verbatim from InspectionService. Ownership checks +
 * photo-key validation call back through the facade (getInspection /
 * isInspectionPhotoKey).
 */
export class InspectionAnnotationsService extends InspectionSubService {
    constructor(
        db: D1Database,
        r2: R2Bucket | undefined,
        sdb: ScopedDB | undefined,
        kv: KVNamespace | undefined,
        images: ImagesBinding | undefined,
        private facade: InspectionService,
    ) {
        super(db, r2, sdb, kv, images);
    }

    /**
     * Design System 0520 M14 — PhotoStudio annotation save (subsystem A,
     * phase 4). Server treats `annotations` as opaque text; only enforces
     * the size bound via Zod at the route layer. Caption is user-supplied,
     * displayed in published reports.
     *
     * Returns null when the media row does not belong to the caller's
     * tenant (or the id is unknown) — the route surfaces this as 404 to
     * avoid enumeration leaks.
     */
    async updateMediaAnnotations(
        inspectionId: string,
        mediaId: string,
        tenantId: string,
        annotations: string,
        caption: string,
    ): Promise<
        | { id: string; annotations: string | null; caption: string | null; updatedAt: number }
        | null
    > {
        await this.facade.getInspection(inspectionId, tenantId); // ownership check
        const db = this.getDrizzle();

        const row = await db.select().from(inspectionMediaPool)
            .where(and(
                eq(inspectionMediaPool.id, mediaId),
                eq(inspectionMediaPool.inspectionId, inspectionId),
                eq(inspectionMediaPool.tenantId, tenantId),
            ))
            .get();
        if (!row) return null;

        await db.update(inspectionMediaPool)
            .set({ annotations, caption })
            .where(and(
                eq(inspectionMediaPool.id, mediaId),
                eq(inspectionMediaPool.tenantId, tenantId),
            ));

        return {
            id:          mediaId,
            annotations,
            caption,
            updatedAt:   Date.now(),
        };
    }

    /**
     * Phase T (T11): Saves an annotated composite PNG and Konva node tree for re-editing.
     * Updates inspection_results.data so that data[itemId].photos[photoIndex] gains
     * `annotatedKey` and `annotationsJson` fields. The original photo key is preserved.
     */
    async saveAnnotation(
        inspectionId: string,
        tenantId: string,
        itemId: string,
        photoIndex: number,
        compositeBytes: ArrayBuffer,
        nodesJson: string,
        sectionId?: string,
    ): Promise<{ annotatedKey: string }> {
        if (!this.r2) throw Errors.BadRequest('Storage not available');
        await this.facade.getInspection(inspectionId, tenantId);

        const annotatedKey = `${tenantId}/${inspectionId}/${itemId}_${crypto.randomUUID()}_annotated.png`;
        await this.r2.put(annotatedKey, compositeBytes, {
            httpMetadata: { contentType: 'image/png' }
        });

        const db = this.getDrizzle();
        const [row] = await db.select().from(inspectionResults)
            .where(and(eq(inspectionResults.inspectionId, inspectionId), eq(inspectionResults.tenantId, tenantId)))
            .limit(1);

        interface ResultEntry {
            rating?: string;
            notes?: string;
            photos?: Array<{ key: string; annotatedKey?: string; annotationsJson?: string }>;
        }
        const data: Record<string, ResultEntry> = (typeof row?.data === 'string'
            ? JSON.parse(row.data)
            : row?.data) ?? {};
        const key = sectionId ? findingKey(DEFAULT_UNIT, sectionId, itemId) : itemId;
        const entry = data[key] ?? data[itemId] ?? {};
        const photos = entry.photos ?? [];
        if (!photos[photoIndex]) throw Errors.NotFound('Photo not found at index');
        photos[photoIndex] = { ...photos[photoIndex], annotatedKey, annotationsJson: nodesJson };
        data[key] = { ...entry, photos };
        if (key !== itemId) delete data[itemId]; // migrate on write

        if (row) {
            await db.update(inspectionResults)
                .set({ data, lastSyncedAt: new Date() })
                .where(eq(inspectionResults.id, row.id));
        } else {
            await db.insert(inspectionResults).values({
                id: crypto.randomUUID(),
                tenantId,
                inspectionId,
                data,
                lastSyncedAt: new Date(),
            });
        }
        return { annotatedKey };
    }

    /**
     * Media Studio (cover crop) — bakes a cropped JPEG derivative of the cover
     * source image into R2 and records the re-editable crop transform. Mirrors
     * saveAnnotation: the original source key (cover_photo_id) is preserved so
     * the crop can be re-edited; the report reads cover_image_key first.
     */
    async setCroppedCover(
        inspectionId: string,
        tenantId: string,
        sourceKey: string,
        bakedBytes: ArrayBuffer,
        crop: CoverCrop,
    ): Promise<{ coverImageKey: string }> {
        if (!this.r2) throw Errors.BadRequest('Storage not available');
        await this.facade.getInspection(inspectionId, tenantId);
        const ok = await this.facade.isInspectionPhotoKey(inspectionId, tenantId, sourceKey);
        if (!ok) throw Errors.BadRequest('sourceKey does not reference a photo of this inspection');
        const coverImageKey = `${tenantId}/${inspectionId}/cover_${crypto.randomUUID()}.jpg`;
        await this.r2.put(coverImageKey, bakedBytes, { httpMetadata: { contentType: 'image/jpeg' } });
        const db = this.getDrizzle();
        await db.update(inspections)
            .set({ coverPhotoId: sourceKey, coverImageKey, coverCrop: crop })
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)));
        return { coverImageKey };
    }

    /**
     * Plan 4 — bakes a cropped JPEG derivative of an inspection-item (or per-defect)
     * photo into R2 and records `croppedKey` + `crop` onto the targeted entry.
     * Mirrors saveAnnotation's data load + finding-key resolution + results upsert.
     * Sequential layering rule: a (re-)crop CLEARS any existing annotatedKey/
     * annotationsJson, whose coords were in the previous cropped-pixel space.
     */
    async saveCroppedItemPhoto(
        inspectionId: string,
        tenantId: string,
        itemId: string,
        photoIndex: number,
        bakedBytes: ArrayBuffer,
        crop: PhotoCrop,
        sectionId?: string,
    ): Promise<{ croppedKey: string }> {
        if (!this.r2) throw Errors.BadRequest('Storage not available');
        await this.facade.getInspection(inspectionId, tenantId);

        const croppedKey = `${tenantId}/${inspectionId}/${itemId}_${crypto.randomUUID()}_cropped.jpg`;
        await this.r2.put(croppedKey, bakedBytes, { httpMetadata: { contentType: 'image/jpeg' } });

        const db = this.getDrizzle();
        const [row] = await db.select().from(inspectionResults)
            .where(and(eq(inspectionResults.inspectionId, inspectionId), eq(inspectionResults.tenantId, tenantId)))
            .limit(1);

        interface ResultEntry { rating?: string; notes?: string; photos?: PhotoEntry[] }
        const data: Record<string, ResultEntry> = (typeof row?.data === 'string' ? JSON.parse(row.data) : row?.data) ?? {};
        const key = sectionId ? findingKey(DEFAULT_UNIT, sectionId, itemId) : itemId;
        const entry = data[key] ?? data[itemId] ?? {};
        const photos = entry.photos ?? [];
        if (!photos[photoIndex]) throw Errors.NotFound('Photo not found at index');
        // Sequential layering: drop annotation (its coords are in the OLD cropped
        // space), set the new crop.
        const { annotatedKey: _a, annotationsJson: _j, ...keep } = photos[photoIndex];
        void _a; void _j;
        photos[photoIndex] = { ...keep, croppedKey, crop };
        data[key] = { ...entry, photos };
        if (key !== itemId) delete data[itemId];

        if (row) {
            await db.update(inspectionResults).set({ data, lastSyncedAt: new Date() }).where(eq(inspectionResults.id, row.id));
        } else {
            await db.insert(inspectionResults).values({ id: crypto.randomUUID(), tenantId, inspectionId, data, lastSyncedAt: new Date() });
        }
        return { croppedKey };
    }
}
