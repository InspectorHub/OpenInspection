/**
 * What may be uploaded as an inspection document -- one list, imported by every
 * side that needs it.
 *
 * This used to exist twice: once in the upload service and once copied into the
 * browser component, whose header called itself a mirror. A comment asking two
 * files to stay in step is a latent bug, and a third consumer (the statutory
 * form's proof slot) is what made it worth removing rather than restating.
 *
 * The client uses it to reject an obviously-invalid file before streaming it;
 * the server re-validates regardless, because a browser check is a courtesy and
 * never a control.
 *
 * This module holds values only. It is imported by browser code, so it must
 * never reach for I/O, a database, or anything else that cannot be bundled into
 * the client.
 */

/** Largest single upload accepted, in bytes. */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100 MB

/** Filename extensions accepted, lowercase, without the dot. */
export const ALLOWED_EXTENSIONS = new Set([
  'pdf', 'jpg', 'jpeg', 'png', 'heic', 'heif', 'webp',
  'doc', 'docx', 'xls', 'xlsx', 'csv', 'dwg', 'dxf',
]);

/**
 * CAD extensions, accepted on the extension alone: browsers report `.dwg` and
 * `.dxf` as `application/octet-stream`, so there is no MIME type to match.
 */
export const CAD_EXTENSIONS = new Set(['dwg', 'dxf']);

/** MIME types accepted for everything that is not CAD. */
export const ALLOWED_CONTENT_TYPES = new Set([
  'application/pdf',
  'image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
]);
