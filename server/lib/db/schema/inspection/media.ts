import { sqliteTable, text, integer, real, uniqueIndex, index, primaryKey } from 'drizzle-orm/sqlite-core';

// Sprint 3 S3-3 — T-key Tag system. Tenant-scoped tag library + a
// many-to-many link table connecting an inspection-item position to one or
// more tags. Internal-only (never rendered on customer-facing report).
//
// Design notes:
//   - `name` is unique per tenant.
//   - `is_seed` marks the five default tags planted on first /tags visit.
//   - The link table uses (inspection_id, item_id, tag_id) as a composite
//     PK so re-linking the same tag is a no-op without DELETE-then-INSERT.
export const tags = sqliteTable('tags', {
    id:        text('id').primaryKey(),
    tenantId:  text('tenant_id').notNull(),
    name:      text('name').notNull(),
    color:     text('color'),
    isSeed:    integer('is_seed', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').notNull(),
}, (t) => ({
    tenantNameUnique: uniqueIndex('idx_tags_tenant_name').on(t.tenantId, t.name),
    tenantIdx:        index('idx_tags_tenant').on(t.tenantId),
}));

export const inspectionItemTagLinks = sqliteTable('inspection_item_tag_links', {
    inspectionId: text('inspection_id').notNull(),
    itemId:       text('item_id').notNull(),
    tagId:        text('tag_id').notNull(),
    tenantId:     text('tenant_id').notNull(),
    createdAt:    integer('created_at').notNull(),
}, (t) => [
    primaryKey({ columns: [t.inspectionId, t.itemId, t.tagId] }),
    index('idx_tag_links_tenant').on(t.tenantId),
    index('idx_tag_links_tag').on(t.tagId),
    index('idx_tag_links_inspection_item').on(t.inspectionId, t.itemId),
]);

// Round-2 backlog #9 (Spectora §E.3) — Media Center pool. Photos uploaded
// ahead of item placement live here until the inspector drags one onto an
// item textarea, at which point InspectionService.attachPoolPhoto moves it
// into inspection_results.data[itemId].photos[] and deletes the pool row.
export const inspectionMediaPool = sqliteTable('inspection_media_pool', {
    id:            text('id').primaryKey(),
    inspectionId:  text('inspection_id').notNull(),
    tenantId:      text('tenant_id').notNull(),
    r2Key:         text('r2_key').notNull(),
    url:           text('url').notNull(),
    uploadedAt:    integer('uploaded_at').notNull(),
    // JSON envelope: { takenAt?: number, gps?: {lat,lng}, cameraModel?: string }
    exifData:      text('exif_data', { mode: 'json' }).$type<{
        takenAt?:     number;
        gps?:         { lat: number; lng: number };
        cameraModel?: string;
    }>(),
    // Design System 0520 M14 — PhotoStudio annotation overlay (subsystem A,
    // phase 4). `annotations` is opaque JSON-encoded shape array (≤8 KB)
    // consumed exclusively client-side. `caption` is user-supplied, ≤200 chars.
    annotations:   text('annotations'),
    caption:       text('caption'),
    // Plan 7 — video walk-through. A pool row is a photo (default) or a video.
    // Video rows keep r2Key/url = '' (Cloudflare Stream owns the bytes) and set
    // streamUid; existing photo rows backfill to 'photo' via the column default.
    mediaType:     text('media_type', { enum: ['photo', 'video'] }).notNull().default('photo'),
    // Cloudflare Stream UID for video rows; NULL for photos.
    streamUid:     text('stream_uid'),
    // Poster timestamp as a fraction of duration (0..1); NULL for photos.
    posterPct:     real('poster_pct'),
    // Video duration in seconds (cached from Stream for the thumb badge); NULL for photos.
    durationSec:   integer('duration_sec'),
}, (t) => [
    index('idx_media_pool_tenant').on(t.tenantId),
    index('idx_media_pool_inspection').on(t.inspectionId),
]);

// Bookkeeping for the background orphaned-media GC (Q8). Each row records the
// first time an R2 object under an inspection prefix was observed unreferenced;
// the sweep deletes it only once that age exceeds the grace window.
export const orphanedMedia = sqliteTable('orphaned_media', {
    id:           text('id').primaryKey(),
    tenantId:     text('tenant_id').notNull(),
    inspectionId: text('inspection_id').notNull(),
    r2Key:        text('r2_key').notNull(),
    firstSeenAt:  integer('first_seen_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    index('idx_orphaned_media_key').on(t.tenantId, t.r2Key),
]);
