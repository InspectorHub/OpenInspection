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
  // Who put the file here — and, with `visibility`, the read gate: the client
  // list and download drop inspector+internal rows, and a client may DELETE only
  // rows whose `uploaded_by_ref` is their own. client vs co_client comes from the
  // resolved portal grant (`resolveClientActor`), never from the request.
  uploadedByKind: text('uploaded_by_kind', { enum: UPLOADER_KINDS }).notNull(),
  uploadedByRef:  text('uploaded_by_ref').notNull(),  // client: recipient email; inspector: user id
  uploadedByName: text('uploaded_by_name'),
  // Filing only: the uploader picks it at upload time (required query param) and
  // the documents list groups rows by it in DOCUMENT_CATEGORIES order. No
  // behaviour keys on it.
  category:       text('category', { enum: DOCUMENT_CATEGORIES }).notNull(),
  // Means something only on an INSPECTOR row: 'internal' hides the file from the
  // client list and 404s its download. The client upload route hard-codes
  // 'client_visible', and the inspector's own list/download ignore this column.
  visibility:     text('visibility', { enum: DOCUMENT_VISIBILITIES }).notNull(),
  r2Key:          text('r2_key').notNull(),
  filename:       text('filename').notNull(),         // ORIGINAL name (display + download)
  // The request's declared content-type, checked against the service allow-list
  // (CAD extensions exempt) and also written onto the R2 object. Echoed as the
  // download's Content-Type under `nosniff`, so a wrong value is a served header.
  contentType:    text('content_type').notNull(),
  sizeBytes:      integer('size_bytes').notNull(),
  label:          text('label'),
  createdAt:      integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => ({
  idxInspection: index('idx_client_uploads_inspection').on(t.tenantId, t.inspectionId),
}));

export type ClientUpload = typeof clientUploads.$inferSelect;
