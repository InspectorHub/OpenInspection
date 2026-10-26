import { sqliteTable, text, integer, primaryKey, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

/**
 * The ledger of one chunked (multipart) video upload to object storage.
 *
 * The storage binding cannot list the parts of an unfinished multipart upload, and a
 * native client's upload plugin does not hand back a response body, so the server is the
 * only place that can remember what has arrived. One row per upload token (`media_id` is
 * minted per token): everything that fixes the upload (size, part size, key, stored type)
 * is written here once and read back by every later request, never taken from the request.
 *
 * `upload_id`, `r2_key` and `content_type` stay NULL until the first part has been read:
 * the stored type and the key extension come from the file's own first bytes, so the
 * storage upload is not opened until they are known.
 *
 * A finished upload keeps its row (state `completed`) until `expires_at`, which is how a
 * replayed token is refused after the object exists. `expires_at` is the token's expiry
 * plus an hour: once past it no request can continue the upload and it may be aborted.
 *
 * Referential integrity is enforced by the service layer (no foreign keys). A tenant
 * purge removes the rows (they carry `tenant_id`).
 */
export const videoUploads = sqliteTable('video_uploads', {
    id:           text('id').primaryKey(),
    tenantId:     text('tenant_id').notNull(),
    inspectionId: text('inspection_id').notNull(),
    mediaId:      text('media_id').notNull(),
    userId:       text('user_id').notNull(),
    uploadId:     text('upload_id'),
    r2Key:        text('r2_key'),
    contentType:  text('content_type', { enum: ['video/mp4', 'video/quicktime', 'video/webm'] }),
    totalBytes:   integer('total_bytes').notNull(),
    partBytes:    integer('part_bytes').notNull(),
    partCount:    integer('part_count').notNull(),
    state:        text('state', { enum: ['open', 'completing', 'completed', 'aborted', 'failed'] }).notNull(),
    createdAt:    integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    expiresAt:    integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    completedAt:  integer('completed_at', { mode: 'timestamp_ms' }),
    // When the upload moved open -> completing; a row stuck there past a minute is settled by looking at the object itself.
    completingAt: integer('completing_at', { mode: 'timestamp_ms' }),
}, (t) => [
    uniqueIndex('uq_video_uploads_media').on(t.tenantId, t.mediaId),
    index('idx_video_uploads_sweep').on(t.state, t.expiresAt),
]);

/** One received part of an unfinished upload: its storage tag (needed to complete) and its size. */
export const videoUploadParts = sqliteTable('video_upload_parts', {
    tenantId:   text('tenant_id').notNull(),
    mediaId:    text('media_id').notNull(),
    partNumber: integer('part_number').notNull(),
    etag:       text('etag').notNull(),
    sizeBytes:  integer('size_bytes').notNull(),
    receivedAt: integer('received_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    primaryKey({ columns: [t.tenantId, t.mediaId, t.partNumber] }),
]);

export type VideoUpload = typeof videoUploads.$inferSelect;
