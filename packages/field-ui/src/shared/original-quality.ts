/**
 * localStorage key for the device-local opt-out of the upload preprocessing
 * pass (downscale + EXIF/GPS strip). Shared by the editor route, which reads it
 * at the photo entry points, and the settings sheet, which writes it.
 */
export const ORIGINAL_QUALITY_KEY = "oi.uploads.originalQuality";
