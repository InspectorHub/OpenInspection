/**
 * Single source of truth for every R2 object key in the PHOTOS bucket.
 * Root is always `{tenantId}/` so per-tenant list/meter/purge is one prefix.
 * Object id is a stable `{mediaId}` (UUID), NEVER `{itemId}` — photos move
 * between items via the DB, so the key must not encode item membership.
 * Add a builder here rather than forming a key string inline anywhere else.
 *
 * -- THE ONE EXCEPTION, AND WHY IT IS ONE ------------------------------------
 * `statutoryFormSource` is the only key here that does NOT begin with
 * `{tenantId}/`. What it addresses is an authority's own published PDF: the
 * same bytes of the same state government document, identical for every
 * workspace that renders that form.
 *
 * Storing it per tenant would copy one state form N times, and -- the part that
 * actually bites -- a tenant-level purge would delete it. Deleting a workspace
 * would then quietly remove the substrate every OTHER workspace renders that
 * form from, and the failure would surface much later as a form that cannot be
 * produced, with nothing connecting it to the deletion.
 *
 * It is placed under `_platform/` because a tenant id is a UUID and `_` is not
 * in that alphabet, so the prefix cannot collide with a real tenant root
 * (checked rather than assumed). Anything under `_platform/` is deployment
 * data, out of scope for per-tenant list, meter and purge by construction.
 */
export const r2Keys = {
  /**
   * An authority's published form PDF. NOT tenant-scoped -- see the exception in
   * the file header. `version` is the authority's own revision label, so the key
   * is stable across republishes of a DIFFERENT revision and never overwrites
   * one already in use by a delivered inspection.
   */
  statutoryFormSource: (formId: string, version: string) =>
    `_platform/statutory-forms/${formId}/${encodeURIComponent(version)}.pdf`,
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
  // Credential badge image — the `logo-` segment keeps it matching the shared
  // brand-asset serving predicate (isServableBrandAsset).
  credentialImage: (t: string, credentialId: string, mediaId: string, ext: string) =>
    `${t}/credentials/${credentialId}/logo-${mediaId}.${ext}`,
  inspectorPhoto: (t: string, userId: string, ext: string) =>
    `${t}/inspector-photos/${userId}.${ext}`,
  /** Serve-side variant — accepts the full filename (userId.ext) from the URL param. */
  inspectorPhotoServe: (t: string, filename: string) =>
    `${t}/inspector-photos/${filename}`,
  messageAttachment: (t: string, messageId: string, attachmentId: string, ext: string) =>
    `${t}/messages/${messageId}/${attachmentId}.${ext}`,
  // The file an intake run was created from. Under the plain tenant prefix on
  // purpose: the tenant-level export and the tenant-level purge both walk
  // `{tenantId}/`, so an object here is reachable by both without either being
  // taught that intake exists.
  migrationSource: (t: string, batchId: string, ext: string) =>
    `${t}/migrations/${batchId}/source.${ext}`,
};
