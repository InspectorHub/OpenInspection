import { preprocessImage } from './preprocessImage';

/**
 * The photo to hand on for one picked or captured file: the baked one (auto-orient, downscale, EXIF/GPS strip), or the
 * original when baking fails. The caller skips this entirely when the user opted into original quality, so that path
 * stays free of extra awaits. A decode error already fails open inside
 * `preprocessImage`; a canvas failure can still reject, and one photo must not drop the rest of its batch. Whatever is
 * returned still goes through the host's own size and type checks later, so the fallback skips no validation.
 */
export async function bakePhoto(file: File): Promise<File> {
  try {
    return await preprocessImage(file);
  } catch {
    return file;
  }
}
