import { isDecodeImageError, type DecodeImage } from '../../decode-image';
import { preprocessImage } from './preprocessImage';

/**
 * The photo to hand on for one picked or captured file: the baked one (auto-orient, downscale, EXIF/GPS strip), or the
 * original when baking fails. The caller skips this entirely when the user opted into original quality, so that path
 * stays free of extra awaits. A decode error already fails open inside
 * `preprocessImage`; a canvas failure can still reject, and one photo must not drop the rest of its batch. A
 * `DecodeImageError` from the host's `decodeImage` is the one rejection that passes through: the caller reports it. Whatever is
 * returned still goes through the host's own size and type checks later, so the fallback skips no validation.
 */
export async function bakePhoto(file: File, decodeImage?: DecodeImage): Promise<File> {
  try {
    return await preprocessImage(file, { decodeImage });
  } catch (e) {
    if (isDecodeImageError(e)) throw e;
    return file;
  }
}
