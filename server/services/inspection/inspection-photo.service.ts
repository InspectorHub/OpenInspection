import { eq, and, sql } from 'drizzle-orm';
import { inspections, inspectionResults, inspectionMediaPool, templates } from '../../lib/db/schema';
import { Errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { findingKey, parseFindingKey, DEFAULT_UNIT } from '../../lib/finding-key';
import { decideFieldWrite, applyFieldWrite } from '../../lib/field-version';
import { stripExifOnIngest, type ImagesBinding } from '../../lib/media/strip-exif';
import { collectAttachedPhotos } from '../../lib/media/collect-attached';
import { applyReorder, applyDetach, applyRevert, moveEntry } from '../../lib/media/photo-ops';
import type { PhotoEntry } from '../../lib/media/collect-attached';
import type { ScopedDB } from '../../lib/db/scoped';
import { sanitizeDefectStates } from './shared';
import { InspectionSubService } from './base';
import type { InspectionService } from '../inspection.service';
import { r2Keys } from '../../lib/r2-keys';

const extFromName = (n: string) => (n.split('.').pop() || 'bin').toLowerCase();

/**
 * Photo + media handling: R2 upload (EXIF strip), media center aggregation,
 * loose pool upload/attach/delete, item-photo reorder/detach/revert/move, the
 * field-version-aware item patch, and the cover-key validation predicate.
 * Extracted verbatim from InspectionService. Ownership checks call back
 * through the facade (getInspection).
 */
export class InspectionPhotoService extends InspectionSubService {
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
     * Multi-photo upload to R2.
     */
    async uploadPhoto(id: string, tenantId: string, _itemId: string, file: File) {
        if (!this.r2) throw Errors.BadRequest('Storage not available');
        await this.facade.getInspection(id, tenantId); // Ownership check

        const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
        if (file.size > MAX_PHOTO_BYTES) {
            throw Errors.BadRequest(`Photo exceeds ${MAX_PHOTO_BYTES} bytes (got ${file.size})`);
        }

        const mediaId = crypto.randomUUID();
        const ext = extFromName(file.name);
        const key = r2Keys.inspectionPhoto(tenantId, id, mediaId, ext);
        // N2 — strip GPS/EXIF on ingest (fallback for any path that skipped the
        // client canvas bake: original-quality uploads, direct API callers,
        // browsers without createImageBitmap). Fails open when env.IMAGES is
        // absent (standalone) — the client bake remains the primary guarantee.
        const { bytes, contentType } = await stripExifOnIngest(this.images, await file.arrayBuffer(), file.type || 'image/jpeg');
        await this.r2.put(key, bytes, {
            httpMetadata: { contentType },
            // A-9: preserve the original upload filename so the serve route can
            // set Content-Disposition without parsing it back out of the key.
            customMetadata: { originalName: file.name || 'photo' },
        });
        return key;
    }

    /**
     * Round-2 backlog #9 (Spectora §E.3) — Media Center.
     *
     * Aggregates every photo associated with an inspection in two groups:
     *   - `attached` — photos already pinned to a specific item, sourced
     *     from inspection_results.data[itemId].photos[]. Includes the item
     *     label and section title so the drawer card can show provenance.
     *   - `pool`     — loose photos uploaded to the inspection_media_pool
     *     table that have not yet been dragged onto an item.
     *
     * Sections/items come from the inspection's template snapshot when
     * available (so a mid-inspection template edit doesn't break labels);
     * otherwise we fall back to the live template row.
     */
    async getMediaCenter(
        inspectionId: string,
        tenantId: string,
    ): Promise<{
        attached: Array<{
            key: string;
            originalKey: string;
            url: string;
            itemId: string;
            itemLabel: string;
            sectionId: string;
            sectionTitle: string;
            photoIndex: number;
            annotated: boolean;
            defectId?: string;
        }>;
        pool: Array<{
            id: string;
            key: string;
            url: string;
            uploadedAt: number;
            takenAt: number | null;
        }>;
    }> {
        const db = this.getDrizzle();

        const insp = await db.select().from(inspections)
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)))
            .get();
        if (!insp) throw Errors.NotFound('Inspection not found');

        // Resolve section/item label map from the snapshot (preferred) or
        // the live template row. Falls back to using the item id as label
        // when neither resolves — the drawer is still usable, just less
        // descriptive.
        interface SchemaItemLite { id: string; label?: string; title?: string }
        interface SchemaSectionLite { id: string; title?: string; name?: string; items?: SchemaItemLite[] }
        let sections: SchemaSectionLite[] = [];
        const snap = insp.templateSnapshot as { sections?: SchemaSectionLite[] } | null;
        if (snap && Array.isArray(snap.sections)) {
            sections = snap.sections;
        } else if (insp.templateId) {
            const tpl = await db.select().from(templates)
                .where(and(eq(templates.id, insp.templateId), eq(templates.tenantId, tenantId)))
                .get();
            const live = tpl?.schema as { sections?: SchemaSectionLite[] } | null;
            if (live && Array.isArray(live.sections)) sections = live.sections;
        }

        const itemMeta = new Map<string, { itemLabel: string; sectionId: string; sectionTitle: string }>();
        for (const sec of sections) {
            const sectionTitle = sec.title || sec.name || 'Section';
            for (const item of (sec.items ?? [])) {
                itemMeta.set(item.id, {
                    itemLabel: item.label || item.title || item.id,
                    sectionId: sec.id,
                    sectionTitle,
                });
            }
        }

        // Pull results — photos live under data[itemId].photos[] plus the
        // canned/custom defect arrays. Mirrors the same shape used by
        // getReportData(). The walk is delegated to the pure
        // collectAttachedPhotos helper so it stays unit-testable.
        const resultsRow = await db.select().from(inspectionResults)
            .where(and(eq(inspectionResults.inspectionId, inspectionId), eq(inspectionResults.tenantId, tenantId)))
            .get();
        const resultData: Record<string, never> = resultsRow?.data
            ? (typeof resultsRow.data === 'string' ? JSON.parse(resultsRow.data) : resultsRow.data) as Record<string, never>
            : {};

        const attached = collectAttachedPhotos(
            resultData,
            itemMeta,
            (key) => `/api/inspections/${inspectionId}/photo?key=${encodeURIComponent(key)}`,
            (k) => { const pk = parseFindingKey(k); return { itemId: pk.itemId, sectionId: pk.sectionId }; },
        );

        // Pool — loose uploads, ordered newest first.
        const poolRows = await db.select().from(inspectionMediaPool)
            .where(and(
                eq(inspectionMediaPool.inspectionId, inspectionId),
                eq(inspectionMediaPool.tenantId, tenantId),
            ))
            .orderBy(sql`${inspectionMediaPool.uploadedAt} desc`)
            .all();

        const pool = poolRows.map(r => ({
            id:          r.id,
            key:         r.r2Key,
            url:         r.url,
            uploadedAt:  r.uploadedAt,
            takenAt:     (r.exifData as { takenAt?: number } | null)?.takenAt ?? null,
        }));

        return { attached, pool };
    }

    /**
     * Round-2 backlog #9 — bulk upload to the loose pool. The photo is not
     * tied to any item until the inspector drags its card onto an item
     * textarea; see {@link attachPoolPhoto}.
     */
    async uploadPoolPhoto(
        inspectionId: string,
        tenantId: string,
        file: File,
        opts?: { takenAt?: number | null | undefined },
    ): Promise<{
        id: string;
        key: string;
        url: string;
        uploadedAt: number;
        takenAt: number | null;
    }> {
        if (!this.r2) throw Errors.BadRequest('Storage not available');
        await this.facade.getInspection(inspectionId, tenantId); // ownership check

        const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
        if (file.size > MAX_PHOTO_BYTES) {
            throw Errors.BadRequest(`Photo exceeds ${MAX_PHOTO_BYTES} bytes (got ${file.size})`);
        }

        const id = crypto.randomUUID();
        const safeName = (file.name || 'photo').replace(/[^a-zA-Z0-9._-]/g, '_');
        const mediaId = id; // the pool row id serves as the stable mediaId
        const key = r2Keys.inspectionPhoto(tenantId, inspectionId, mediaId, extFromName(safeName));
        // N2 — strip GPS/EXIF on ingest (fallback for paths that skipped the
        // client canvas bake). Fails open when env.IMAGES is absent.
        const { bytes, contentType } = await stripExifOnIngest(this.images, await file.arrayBuffer(), file.type || 'image/jpeg');
        await this.r2.put(key, bytes, {
            httpMetadata: { contentType },
            // A-9: keep the real original filename (the key only carries a
            // sanitized variant) for the download Content-Disposition.
            customMetadata: { originalName: file.name || 'photo' },
        });

        const uploadedAt = Date.now();
        const takenAt = (opts?.takenAt && Number.isFinite(opts.takenAt) && opts.takenAt > 0) ? opts.takenAt : null;
        const url = `/api/inspections/${inspectionId}/photo?key=${encodeURIComponent(key)}`;
        const exifData = takenAt !== null ? { takenAt } : null;

        const db = this.getDrizzle();
        await db.insert(inspectionMediaPool).values({
            id,
            inspectionId,
            tenantId,
            r2Key: key,
            url,
            uploadedAt,
            exifData,
        });

        return { id, key, url, uploadedAt, takenAt };
    }

    /**
     * Round-2 backlog #9 — atomically attach a pool photo to an item.
     * Moves the photo entry into inspection_results.data[itemId].photos[]
     * and deletes the pool row. The R2 object is preserved (only the
     * pointer moves) so an in-flight drag can be replayed safely.
     */
    async attachPoolPhoto(
        inspectionId: string,
        tenantId: string,
        poolId: string,
        itemId: string,
        sectionId?: string,
    ): Promise<{ key: string; itemId: string; photoIndex: number }> {
        if (!itemId) throw Errors.BadRequest('itemId is required');
        await this.facade.getInspection(inspectionId, tenantId); // ownership check
        const db = this.getDrizzle();

        const poolRow = await db.select().from(inspectionMediaPool)
            .where(and(
                eq(inspectionMediaPool.id, poolId),
                eq(inspectionMediaPool.inspectionId, inspectionId),
                eq(inspectionMediaPool.tenantId, tenantId),
            ))
            .get();
        if (!poolRow) throw Errors.NotFound('Pool photo not found');

        // Locate or create the inspection_results row, then append the
        // photo to data[key].photos[].
        interface ResultEntry { photos?: Array<{ key: string }> }
        const existing = await db.select().from(inspectionResults)
            .where(and(eq(inspectionResults.inspectionId, inspectionId), eq(inspectionResults.tenantId, tenantId)))
            .get();

        const data: Record<string, ResultEntry> = existing?.data
            ? (typeof existing.data === 'string' ? JSON.parse(existing.data) : existing.data) as Record<string, ResultEntry>
            : {};
        const key = sectionId ? findingKey(DEFAULT_UNIT, sectionId, itemId) : itemId;
        const entry = data[key] ?? data[itemId] ?? {};
        const photos = Array.isArray(entry.photos) ? entry.photos.slice() : [];
        photos.push({ key: poolRow.r2Key });
        data[key] = { ...entry, photos };
        if (key !== itemId) delete data[itemId]; // migrate on write
        const photoIndex = photos.length - 1;

        if (existing) {
            await db.update(inspectionResults)
                .set({ data: data as unknown as object, lastSyncedAt: new Date() })
                .where(eq(inspectionResults.id, existing.id));
        } else {
            await db.insert(inspectionResults).values({
                id:           crypto.randomUUID(),
                tenantId,
                inspectionId,
                data:         data as unknown as object,
                lastSyncedAt: new Date(),
            });
        }

        // The pool row is a staging pointer only; once the photo key is written
        // into results.data the pool row is always removed (the R2 object is
        // preserved). DB-16: the report cover now references an R2 key, not a
        // pool row id, so there is no longer a "cover anchor" reason to keep it.
        await db.delete(inspectionMediaPool)
            .where(and(
                eq(inspectionMediaPool.id, poolId),
                eq(inspectionMediaPool.tenantId, tenantId),
            ));

        return { key: poolRow.r2Key, itemId, photoIndex };
    }

    /**
     * Media Studio (Plan 3, P4) — reorder an item's photos[] so the array
     * order matches the report photo order. Pure permutation: the submitted
     * key set must equal the current one (no add/drop). Reuses the pure
     * {@link applyReorder} op.
     */
    async reorderItemPhotos(
        inspectionId: string,
        tenantId: string,
        itemId: string,
        order: string[],
        sectionId?: string,
    ): Promise<void> {
        await this.facade.getInspection(inspectionId, tenantId); // ownership check
        const db = this.getDrizzle();
        const row = await db.select().from(inspectionResults)
            .where(and(eq(inspectionResults.inspectionId, inspectionId), eq(inspectionResults.tenantId, tenantId)))
            .get();
        if (!row) throw Errors.NotFound('Results not found');
        const data: Record<string, { photos?: { key: string }[] }> = typeof row.data === 'string'
            ? JSON.parse(row.data)
            : (row.data as Record<string, { photos?: { key: string }[] }>);
        const key = sectionId ? findingKey(DEFAULT_UNIT, sectionId, itemId) : itemId;
        const entry = data[key] ?? data[itemId];
        if (!entry?.photos) throw Errors.BadRequest('no photos for item');
        entry.photos = applyReorder(entry.photos, order);
        data[key] = entry;
        await db.update(inspectionResults)
            .set({ data: JSON.stringify(data), lastSyncedAt: new Date() })
            .where(and(eq(inspectionResults.inspectionId, inspectionId), eq(inspectionResults.tenantId, tenantId)));
    }

    /**
     * Media Studio (Plan 3, P4) — detach a photo from an item: drop the
     * array entry, keep the R2 object (it may live in the pool / elsewhere).
     * Reuses the pure {@link applyDetach} op.
     */
    async detachItemPhoto(
        inspectionId: string,
        tenantId: string,
        itemId: string,
        photoIndex: number,
        sectionId?: string,
    ): Promise<void> {
        await this.facade.getInspection(inspectionId, tenantId); // ownership check
        const db = this.getDrizzle();
        const rowSel = await db.select().from(inspectionResults)
            .where(and(eq(inspectionResults.inspectionId, inspectionId), eq(inspectionResults.tenantId, tenantId)))
            .get();
        if (!rowSel) throw Errors.NotFound('Results not found');
        const data: Record<string, { photos?: { key: string }[] }> = typeof rowSel.data === 'string'
            ? JSON.parse(rowSel.data)
            : (rowSel.data as Record<string, { photos?: { key: string }[] }>);
        const key = sectionId ? findingKey(DEFAULT_UNIT, sectionId, itemId) : itemId;
        const entry = data[key] ?? data[itemId];
        if (!entry?.photos) throw Errors.BadRequest('no photos for item');
        entry.photos = applyDetach(entry.photos, photoIndex);
        data[key] = entry;
        await db.update(inspectionResults)
            .set({ data: JSON.stringify(data), lastSyncedAt: new Date() })
            .where(and(eq(inspectionResults.inspectionId, inspectionId), eq(inspectionResults.tenantId, tenantId)));
    }

    /**
     * Media Studio (Plan 3) — revert a photo's edits to the original: drop
     * the annotated derivative (annotatedKey/annotationsJson), keep the
     * source key. Non-destructive editing's "undo". Reuses {@link applyRevert}.
     */
    async revertPhotoEdits(
        inspectionId: string,
        tenantId: string,
        itemId: string,
        photoIndex: number,
        sectionId?: string,
    ): Promise<void> {
        await this.facade.getInspection(inspectionId, tenantId); // ownership check
        const db = this.getDrizzle();
        const rowSel = await db.select().from(inspectionResults)
            .where(and(eq(inspectionResults.inspectionId, inspectionId), eq(inspectionResults.tenantId, tenantId)))
            .get();
        if (!rowSel) throw Errors.NotFound('Results not found');
        const data: Record<string, { photos?: { key: string }[] }> = typeof rowSel.data === 'string'
            ? JSON.parse(rowSel.data)
            : (rowSel.data as Record<string, { photos?: { key: string }[] }>);
        const key = sectionId ? findingKey(DEFAULT_UNIT, sectionId, itemId) : itemId;
        const entry = data[key] ?? data[itemId];
        if (!entry?.photos) throw Errors.BadRequest('no photos for item');
        entry.photos = applyRevert(entry.photos, photoIndex);
        data[key] = entry;
        await db.update(inspectionResults)
            .set({ data: JSON.stringify(data), lastSyncedAt: new Date() })
            .where(and(eq(inspectionResults.inspectionId, inspectionId), eq(inspectionResults.tenantId, tenantId)));
    }

    /**
     * Media Studio (Plan 3, Task 9b) — move a photo from one item to another:
     * detach from the source item's photos[] and append (with all its
     * derivatives) to the target item's photos[]. Both entries live in the same
     * inspection_results.data map, so this is one read/write on the single row.
     * Reuses the pure {@link moveEntry} op.
     */
    async moveItemPhoto(
        inspectionId: string,
        tenantId: string,
        fromItemId: string,
        photoIndex: number,
        toItemId: string,
        fromSectionId?: string,
        toSectionId?: string,
    ): Promise<{ toItemId: string; photoIndex: number }> {
        await this.facade.getInspection(inspectionId, tenantId); // ownership check
        const db = this.getDrizzle();
        const rowSel = await db.select().from(inspectionResults)
            .where(and(eq(inspectionResults.inspectionId, inspectionId), eq(inspectionResults.tenantId, tenantId)))
            .get();
        if (!rowSel) throw Errors.NotFound('Results not found');
        const data: Record<string, { photos?: PhotoEntry[] }> = typeof rowSel.data === 'string'
            ? JSON.parse(rowSel.data)
            : (rowSel.data as Record<string, { photos?: PhotoEntry[] }>);
        const fromKey = fromSectionId ? findingKey(DEFAULT_UNIT, fromSectionId, fromItemId) : fromItemId;
        const toKey   = toSectionId   ? findingKey(DEFAULT_UNIT, toSectionId, toItemId)     : toItemId;
        const fromEntry = data[fromKey] ?? data[fromItemId];
        if (!fromEntry?.photos) throw Errors.BadRequest('no photos for source item');
        const toEntry = data[toKey] ?? data[toItemId] ?? {};
        const moved = moveEntry(fromEntry.photos, toEntry.photos ?? [], photoIndex);
        data[fromKey] = { ...fromEntry, photos: moved.from };
        data[toKey]   = { ...toEntry,   photos: moved.to };
        await db.update(inspectionResults)
            .set({ data: JSON.stringify(data), lastSyncedAt: new Date() })
            .where(and(eq(inspectionResults.inspectionId, inspectionId), eq(inspectionResults.tenantId, tenantId)));
        return { toItemId, photoIndex: moved.to.length - 1 };
    }

    /**
     * Design System 0520 subsystem B phase 3 — field-version-aware item patch.
     *
     * Reads inspection_results.data, runs the field through the version-
     * arithmetic helper (decideFieldWrite), persists on match, returns a
     * conflict payload otherwise. Bumps inspections.dataVersion on every
     * successful write so the offline-queue can detect staleness without
     * fetching the full results blob.
     *
     * Tenant isolation enforced via getInspection ownership check before
     * any read/write touches inspection_results.
     */
    async patchItem(
        inspectionId: string,
        tenantId: string,
        itemId: string,
        field: 'rating' | 'notes' | 'value' | 'cannedToggle' | 'defectFields' | 'itemAttribute',
        value: unknown,
        expectedVersion: number,
        userId: string,
        opts?: { force?: boolean },
        sectionId?: string,
    ): Promise<
        | { kind: 'ok'; newVersion: number; by: string; at: number }
        | { kind: 'conflict'; current: { value: unknown; by?: string; at?: number; v: number }; yours: { value: unknown; expectedVersion: number } }
        | { kind: 'not_found' }
    > {
        // Verify ownership — throws if foreign tenant.
        try {
            await this.facade.getInspection(inspectionId, tenantId);
        } catch {
            return { kind: 'not_found' };
        }

        const db = this.getDrizzle();

        const existing = await db.select().from(inspectionResults)
            .where(and(eq(inspectionResults.inspectionId, inspectionId), eq(inspectionResults.tenantId, tenantId)))
            .get();
        const data: Record<string, Record<string, unknown>> = existing?.data
            ? (typeof existing.data === 'string' ? JSON.parse(existing.data) : existing.data) as Record<string, Record<string, unknown>>
            : {};

        const key = sectionId ? findingKey(DEFAULT_UNIT, sectionId, itemId) : itemId;
        const cur = data[key] ?? data[itemId]; // fallback for legacy

        // Compound writes: defectFields / itemAttribute mutate nested shapes
        // inside the item entry instead of overwriting a single scalar field.
        // We translate them into a normalized entry update on the umbrella
        // sub-key (`tabs` or `attributes`), then let applyFieldWrite handle
        // the version bump on that sub-key so the optimistic-concurrency
        // counter is preserved.
        let mutableField: string = field;
        let mutableValue: unknown = value;
        if (field === 'defectFields' && value && typeof value === 'object' && 'cannedId' in (value as Record<string, unknown>)) {
            const v = value as { cannedId: string; location?: string | null; trade?: string | null; deadline?: string | null; timeframe?: string | null };
            const base = (cur ?? {}) as Record<string, unknown>;
            const tabs = (base.tabs ?? {}) as Record<string, unknown>;
            const defects = Array.isArray(tabs.defects) ? (tabs.defects as Array<Record<string, unknown>>) : [];
            const idx = defects.findIndex(d => d?.cannedId === v.cannedId);
            const next: Record<string, unknown> = idx >= 0 ? { ...defects[idx] } : { cannedId: v.cannedId, included: true };
            if ('location'  in v) next.location  = v.location;
            if ('trade'     in v) next.trade     = v.trade;
            if ('deadline'  in v) next.deadline  = v.deadline;
            if ('timeframe' in v) next.timeframe = v.timeframe;
            const nextDefects = idx >= 0 ? defects.map((d, i) => i === idx ? next : d) : [...defects, next];
            mutableValue = { ...tabs, defects: nextDefects };
            mutableField = 'tabs';
        }
        if (field === 'itemAttribute' && value && typeof value === 'object' && 'attributeId' in (value as Record<string, unknown>)) {
            const v = value as { attributeId: string; value: unknown };
            const base = (cur ?? {}) as Record<string, unknown>;
            const attrs = (base.attributes ?? {}) as Record<string, unknown>;
            const nextAttrs = { ...attrs, [v.attributeId]: v.value };
            mutableField = 'attributes' as typeof field;
            mutableValue = nextAttrs;
        }

        const decision = decideFieldWrite(cur, mutableField, mutableValue, expectedVersion, { force: opts?.force ?? false });
        if (decision.kind === 'conflict') return decision;

        const now = Math.floor(Date.now() / 1000);
        const { entry, newVersion } = applyFieldWrite(cur, mutableField, mutableValue, userId, now);
        data[key] = entry;
        sanitizeDefectStates(data);
        if (key !== itemId) delete data[itemId]; // migrate on write

        if (existing) {
            await db.update(inspectionResults)
                .set({ data: data as unknown as object, lastSyncedAt: new Date() })
                .where(eq(inspectionResults.id, existing.id));
        } else {
            await db.insert(inspectionResults).values({
                id:           crypto.randomUUID(),
                tenantId,
                inspectionId,
                data:         data as unknown as object,
                lastSyncedAt: new Date(),
            });
        }

        // Bump inspections.dataVersion — offline queue uses this counter
        // to detect "the rest of the world moved" without re-fetching the
        // entire results JSON.
        await db.update(inspections)
            .set({ dataVersion: sql`${inspections.dataVersion} + 1` })
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)));

        return { kind: 'ok', newVersion, by: userId, at: now };
    }

    /**
     * Round-2 backlog #9 — delete a loose pool photo (drag cancel / cleanup).
     * Hard-deletes both the DB row and the R2 object.
     */
    async deletePoolPhoto(
        inspectionId: string,
        tenantId: string,
        poolId: string,
    ): Promise<void> {
        await this.facade.getInspection(inspectionId, tenantId); // ownership check
        const db = this.getDrizzle();

        const row = await db.select().from(inspectionMediaPool)
            .where(and(
                eq(inspectionMediaPool.id, poolId),
                eq(inspectionMediaPool.inspectionId, inspectionId),
                eq(inspectionMediaPool.tenantId, tenantId),
            ))
            .get();
        if (!row) throw Errors.NotFound('Pool photo not found');

        // P8 — block deletion when this pool photo is still wired as the
        // report cover (either the uncropped source or the baked crop), which
        // would orphan the cover. Force the user to clear the cover first.
        const insp = await db.select({ coverPhotoId: inspections.coverPhotoId, coverImageKey: inspections.coverImageKey })
            .from(inspections)
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)))
            .get();
        if (insp && (insp.coverPhotoId === row.r2Key || insp.coverImageKey === row.r2Key)) {
            throw Errors.Conflict('This photo is set as the report cover — clear the cover first.');
        }

        await db.delete(inspectionMediaPool)
            .where(and(
                eq(inspectionMediaPool.id, poolId),
                eq(inspectionMediaPool.tenantId, tenantId),
            ));

        if (this.r2) {
            await this.r2.delete(row.r2Key).catch(err => {
                logger.warn('[media-pool] R2 delete failed', { key: row.r2Key, error: String(err) });
            });
        }
    }

    /**
     * DB-16 — is `key` the R2 key of a photo belonging to this inspection?
     * The report cover (`inspections.cover_photo_id`) holds an R2 key; this
     * validates a chosen cover. True when `key` matches any attached item photo
     * (`inspection_results.data[*].photos[].key` or `.annotatedKey`) or any loose
     * `inspection_media_pool` row's r2Key. Tenant-scoped; false for foreign keys.
     */
    async isInspectionPhotoKey(inspectionId: string, tenantId: string, key: string): Promise<boolean> {
        if (!key) return false;
        const db = this.getDrizzle();

        // 1. Loose pool photos.
        const pool = await db.select({ r2Key: inspectionMediaPool.r2Key })
            .from(inspectionMediaPool)
            .where(and(
                eq(inspectionMediaPool.inspectionId, inspectionId),
                eq(inspectionMediaPool.tenantId, tenantId),
            ))
            .all();
        if (pool.some(p => p.r2Key === key)) return true;

        // 2. Attached item photos in inspection_results.data[*].photos[].
        const rows = await db.select({ data: inspectionResults.data })
            .from(inspectionResults)
            .where(and(
                eq(inspectionResults.inspectionId, inspectionId),
                eq(inspectionResults.tenantId, tenantId),
            ))
            .all();
        for (const row of rows) {
            const data = (typeof row.data === 'string' ? JSON.parse(row.data) : row.data) as
                Record<string, { photos?: Array<{ key?: string; annotatedKey?: string }> }> | null;
            if (!data) continue;
            for (const entry of Object.values(data)) {
                const photos = Array.isArray(entry?.photos) ? entry.photos : [];
                for (const p of photos) {
                    if (p?.key === key || p?.annotatedKey === key) return true;
                }
            }
        }
        return false;
    }
}
