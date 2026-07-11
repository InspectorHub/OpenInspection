/**
 * Single source of truth for every R2 object key in the PHOTOS bucket.
 * Root is always `{tenantId}/` so per-tenant list/meter/purge is one prefix.
 * Object id is a stable `{mediaId}` (UUID), NEVER `{itemId}` — photos move
 * between items via the DB, so the key must not encode item membership.
 * Add a builder here rather than forming a key string inline anywhere else.
 */
export const r2Keys = {
  inspectionPhoto: (t: string, i: string, mediaId: string, ext: string) =>
    `${t}/inspections/${i}/photos/${mediaId}.${ext}`,
  inspectionPhotoAnnotated: (t: string, i: string, mediaId: string) =>
    `${t}/inspections/${i}/photos/${mediaId}.annotated.png`,
  inspectionPhotoCropped: (t: string, i: string, mediaId: string) =>
    `${t}/inspections/${i}/photos/${mediaId}.cropped.jpg`,
  inspectionVideo: (t: string, i: string, mediaId: string, ext: string) =>
    `${t}/inspections/${i}/videos/${mediaId}.${ext}`,
  inspectionVideoPoster: (t: string, i: string, mediaId: string) =>
    `${t}/inspections/${i}/videos/${mediaId}.poster.jpg`,
  inspectionCover: (t: string, i: string, mediaId: string) =>
    `${t}/inspections/${i}/cover/${mediaId}.jpg`,
  inspectionDocument: (t: string, i: string, docId: string, filename: string) =>
    `${t}/inspections/${i}/documents/${docId}-${filename}`,
  // Note: report PDFs are content-hash-addressed and built inline in
  // server/services/report-pdf.service.ts — not via a key builder here.
  // Commercial PCA Phase W — async .docx export, one object per exportId
  // (report_exports.id); see server/services/report-export.service.ts.
  reportWordExport: (t: string, i: string, exportId: string) =>
    `${t}/inspections/${i}/exports/${exportId}.docx`,
  agreementFile: (t: string, i: string, envelopeId: string, name: string) =>
    `${t}/inspections/${i}/agreements/${envelopeId}/${name}`,
  brandingLogo: (t: string, mediaId: string, ext: string) =>
    `${t}/branding/logo-${mediaId}.${ext}`,
  inspectorPhoto: (t: string, userId: string, ext: string) =>
    `${t}/inspector-photos/${userId}.${ext}`,
  /** Serve-side variant — accepts the full filename (userId.ext) from the URL param. */
  inspectorPhotoServe: (t: string, filename: string) =>
    `${t}/inspector-photos/${filename}`,
  messageAttachment: (t: string, messageId: string, attachmentId: string, ext: string) =>
    `${t}/messages/${messageId}/${attachmentId}.${ext}`,
};
