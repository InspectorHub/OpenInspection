import { isDecodeImageError, type DecodeImage, type DecodeImageError } from '../../decode-image';
import { bakePhoto } from './bakePhoto';
import { looksLikeHeif } from './sniffHeif';

/** The largest photo a host stores; a HEIC converted with keep original on is asked to fit within it. */
export const KEEP_ORIGINAL_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Keep-original skips the bake, but a HEIC the host can decode is still converted (a browser cannot show it), at full
 * size and the highest quality that fits `KEEP_ORIGINAL_MAX_BYTES`. Everything else is returned as picked.
 */
async function keepOriginalPhoto(file: File, decodeImage?: DecodeImage): Promise<File> {
  if (!decodeImage) return file;
  try {
    if (!(await looksLikeHeif(file))) return file;
    const decoded = await decodeImage(file, { keepOriginal: { maxBytes: KEEP_ORIGINAL_MAX_BYTES } });
    if (!decoded) return file;
    const baseName = (file.name || 'photo').replace(/\.[^.]+$/, '');
    return new File([decoded.blob], `${baseName}.jpg`, { type: 'image/jpeg', lastModified: file.lastModified });
  } catch (e) {
    if (isDecodeImageError(e)) throw e;
    return file;
  }
}

/**
 * The files to hand on for one picked batch, in order. A file the host recognised as HEIC but could not decode is
 * skipped and reported through `onDecodeError`; the rest of the batch still goes through.
 */
export async function bakeBatch(
  files: File[],
  keepOriginal: boolean,
  decodeImage: DecodeImage | undefined,
  onDecodeError: (error: DecodeImageError, file: File) => void,
): Promise<File[]> {
  const out: File[] = [];
  for (const f of files) {
    try {
      out.push(keepOriginal ? await keepOriginalPhoto(f, decodeImage) : await bakePhoto(f, decodeImage));
    } catch (e) {
      if (isDecodeImageError(e)) onDecodeError(e, f);
      else out.push(f);
    }
  }
  return out;
}
