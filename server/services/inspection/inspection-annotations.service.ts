import { eq, and } from 'drizzle-orm';
import { inspections, inspectionResults, inspectionMediaPool } from '../../lib/db/schema';
import { Errors } from '../../lib/errors';
import { findingKey, DEFAULT_UNIT } from '@core/field-ui/shared/finding-key';
import type { CoverCrop, PhotoCrop } from '../../lib/validations/inspection.schema';
import type { PhotoEntry } from '../../lib/media/collect-attached';
import type { ScopedDB } from '../../lib/db/scoped';
import type { ImagesBinding } from '../../lib/media/strip-exif';
import { InspectionSubService } from './base';
import type { InspectionService } from '../inspection.service';
import { r2Keys, photoMediaId as mediaIdFromKey } from '../../lib/r2-keys';
import { assertPhotoSize } from '../../lib/media/store-photo';

/** A short unique suffix for a baked derivative's key: every bake is a new object (see `r2Keys.inspectionPhotoAnnotated`). */
const newRevision = (): string => crypto.randomUUID().slice(0, 8);

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
     *
     * #181 — when `opts.skipResultsWrite` is true (the tenant's collabEditing flag
     * is ON), the R2 derivative is still baked and the key returned, but the
     * `inspection_results.data` write is skipped entirely: the Y.Doc / Durable
     * Object is the sole authoritative writer of that blob, and the client mirrors
     * the returned `annotatedKey` into the doc. Without this skip the next DO
     * `persist()` would clobber the server's metadata write.
     */
    async saveAnnotation(
        inspectionId: string,
        tenantId: string,
        itemId: string,
        photoIndex: number,
        compositeBytes: ArrayBuffer,
        nodesJson: string,
        sectionId?: string,
        opts?: { skipResultsWrite?: boolean },
    ): Promise<{ annotatedKey: string }> {
        assertPhotoSize(compositeBytes.byteLength);
        if (!this.r2) throw Errors.BadRequest('Storage not available');
        await this.facade.getInspection(inspectionId, tenantId);

        const db = this.getDrizzle();
        const [row] = await db.select().from(inspectionResults)
            .where(and(eq(inspectionResults.inspectionId, inspectionId), eq(inspectionResults.tenantId, tenantId)))
            .limit(1);

        interface ResultEntry {
            rating?: string;
            notes?: string;
            photos?: Array<{ key: string; croppedKey?: string; annotatedKey?: string; annotationsJson?: string }>;
        }
        const data: Record<string, ResultEntry> = (typeof row?.data === 'string'
            ? JSON.parse(row.data)
            : row?.data) ?? {};
        const key = sectionId ? findingKey(DEFAULT_UNIT, sectionId, itemId) : itemId;
        const entry = data[key] ?? data[itemId] ?? {};
        const photos = entry.photos ?? [];
        if (!photos[photoIndex]) throw Errors.NotFound('Photo not found at index');

        // Co-locate the annotated derivative with its source photo by reusing
        // the same mediaId. Fall back to a new UUID only for old-shape keys.
        const sourceMediaId = mediaIdFromKey(photos[photoIndex].key) ?? crypto.randomUUID();
        const annotatedKey = r2Keys.inspectionPhotoAnnotated(tenantId, inspectionId, sourceMediaId, newRevision());
        await this.r2.put(annotatedKey, compositeBytes, {
            httpMetadata: { contentType: 'image/png' }
        });
        await this.followCover(inspectionId, tenantId, photos[photoIndex], annotatedKey, false);

        // #181 — collab ON: the R2 object is the authoritative binary; the doc
        // owns the JSON metadata. Skip the results.data write entirely.
        if (opts?.skipResultsWrite) {
            return { annotatedKey };
        }

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
        assertPhotoSize(bakedBytes.byteLength);
        if (!this.r2) throw Errors.BadRequest('Storage not available');
        await this.facade.getInspection(inspectionId, tenantId);
        const ok = await this.facade.isInspectionPhotoKey(inspectionId, tenantId, sourceKey);
        if (!ok) throw Errors.BadRequest('sourceKey does not reference a photo of this inspection');
        const coverImageKey = r2Keys.inspectionCover(tenantId, inspectionId, crypto.randomUUID());
        await this.r2.put(coverImageKey, bakedBytes, { httpMetadata: { contentType: 'image/jpeg' } });
        const db = this.getDrizzle();
        // Unconditional on purpose: choosing a cover replaces whatever the cover was. The only race is the photo being
        // removed between the check above and this write, which leaves the same dangling cover a delete leaves anyway.
        await db.update(inspections)
            .set({ coverPhotoId: sourceKey, coverImageKey, coverCrop: crop })
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)));
        return { coverImageKey };
    }

    /**
     * The report cover names a photo by the key it shows. A derivative baked again gets a new key, so a cover that
     * belonged to this photo moves to the new one (it used to follow by being overwritten). A cover that names any
     * other photo is left alone.
     *
     * "Belongs to this photo" is any key of the photo: its original, the cropped and annotated files its entry names,
     * or any other derivative in its family (`{mediaId}.annotated.*` / `{mediaId}.cropped.*`). The entry can lag behind
     * under collaborative editing (the results row is written late), so two quick bakes would otherwise leave the second
     * one looking for a key the first had already replaced.
     *
     * The baked cover file (`coverImageKey`) is cleared either way: it is made on the client from the old image and the
     * report prefers it (`resolveCoverUrl`), so it would keep showing the old frame or the photo without the new strokes;
     * with it gone the report cover is the photo as the editor shows it. `frameChanged` (a crop) also clears the stored cover
     * crop, a rectangle in the old frame. An annotation keeps the frame, so the rectangle stays and "Adjust cover" reopens on
     * it; saving there bakes the cover again, with the strokes. (The server cannot re-bake: the crop is rendered on the client.)
     */
    private async followCover(inspectionId: string, tenantId: string, entry: PhotoEntry, to: string, frameChanged: boolean): Promise<void> {
        const db = this.getDrizzle();
        const row = await db.select({ cover: inspections.coverPhotoId }).from(inspections)
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId))).get();
        const cover = row?.cover;
        if (!cover || cover === to) return;
        const mediaId = mediaIdFromKey(entry.key);
        const family = mediaId ? r2Keys.inspectionPhotosPrefix(tenantId, inspectionId) + mediaId : null;
        const belongs = [entry.key, entry.croppedKey, entry.annotatedKey].includes(cover)
            || (family !== null && (cover.startsWith(`${family}.annotated.`) || cover.startsWith(`${family}.cropped.`)));
        if (!belongs) return;
        // Compare-and-set: a cover changed meanwhile by someone else is left as they set it.
        await db.update(inspections)
            .set({ coverPhotoId: to, coverImageKey: null, ...(frameChanged ? { coverCrop: null } : {}) })
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId), eq(inspections.coverPhotoId, cover)));
    }

    /**
     * Plan 4 — bakes a cropped JPEG derivative of an inspection-item (or per-defect)
     * photo into R2 and records `croppedKey` + `crop` onto the targeted entry.
     * Mirrors saveAnnotation's data load + finding-key resolution + results upsert.
     * Sequential layering rule: a (re-)crop CLEARS any existing annotatedKey/
     * annotationsJson, whose coords were in the previous cropped-pixel space.
     *
     * #181 — when `opts.skipResultsWrite` is true (the tenant's collabEditing flag
     * is ON), the cropped R2 derivative is still baked and `croppedKey` returned,
     * but the `inspection_results.data` write is skipped: the Y.Doc / Durable
     * Object owns that blob. The client mirrors the crop into the doc (replacing
     * the photo entry in place, which also drops the annotation per the
     * sequential-layering rule above).
     */
    async saveCroppedItemPhoto(
        inspectionId: string,
        tenantId: string,
        itemId: string,
        photoIndex: number,
        bakedBytes: ArrayBuffer,
        crop: PhotoCrop,
        sectionId?: string,
        opts?: { skipResultsWrite?: boolean },
    ): Promise<{ croppedKey: string }> {
        assertPhotoSize(bakedBytes.byteLength);
        if (!this.r2) throw Errors.BadRequest('Storage not available');
        await this.facade.getInspection(inspectionId, tenantId);

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

        // Co-locate the cropped derivative with its source photo by reusing
        // the same mediaId. Fall back to a new UUID only for old-shape keys.
        const sourceMediaId = mediaIdFromKey(photos[photoIndex].key) ?? crypto.randomUUID();
        const croppedKey = r2Keys.inspectionPhotoCropped(tenantId, inspectionId, sourceMediaId, newRevision());
        await this.r2.put(croppedKey, bakedBytes, { httpMetadata: { contentType: 'image/jpeg' } });
        await this.followCover(inspectionId, tenantId, photos[photoIndex], croppedKey, true);

        // #181 — collab ON: the R2 object is the authoritative binary; the doc
        // owns the JSON metadata. Skip the results.data write entirely.
        if (opts?.skipResultsWrite) {
            return { croppedKey };
        }

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
