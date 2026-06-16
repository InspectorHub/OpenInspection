import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

export const DOCUMENT_CATEGORIES = [
  'prior_reports', 'plans_drawings', 'environmental',
  'leases_financials', 'permits_certificates', 'photos', 'other',
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const DOCUMENT_VISIBILITIES = ['client_visible', 'internal'] as const;
export type DocumentVisibility = (typeof DOCUMENT_VISIBILITIES)[number];

export const UPLOADER_KINDS = ['client', 'co_client', 'inspector'] as const;
export type UploaderKind = (typeof UPLOADER_KINDS)[number];

// Carries BOTH directions despite the client_ prefix (uploaded_by_kind includes 'inspector').
export const clientUploads = sqliteTable('client_uploads', {
  id:             text('id').primaryKey(),
  tenantId:       text('tenant_id').notNull(),
  inspectionId:   text('inspection_id').notNull(),
  uploadedByKind: text('uploaded_by_kind', { enum: UPLOADER_KINDS }).notNull(),
  uploadedByRef:  text('uploaded_by_ref').notNull(),  // client: recipient email; inspector: user id
  uploadedByName: text('uploaded_by_name'),
  category:       text('category', { enum: DOCUMENT_CATEGORIES }).notNull(),
  visibility:     text('visibility', { enum: DOCUMENT_VISIBILITIES }).notNull(),
  r2Key:          text('r2_key').notNull(),
  filename:       text('filename').notNull(),         // ORIGINAL name (display + download)
  contentType:    text('content_type').notNull(),
  sizeBytes:      integer('size_bytes').notNull(),
  label:          text('label'),
  createdAt:      integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => ({
  idxInspection: index('idx_client_uploads_inspection').on(t.tenantId, t.inspectionId),
}));

export type ClientUpload = typeof clientUploads.$inferSelect;
