/**
 * Upload preprocessing (backlog N2+N4) — one canvas bake per photo before
 * upload: downsample to a 2560 long edge, re-encode JPEG q=0.82, auto-orient
 * via createImageBitmap, and (by canvas redraw) discard ALL source metadata
 * including GPS/EXIF. This is the PRIMARY EXIF strip; the server env.IMAGES
 * re-encode in uploadPoolPhoto is the fallback for paths that skip this.
 */
import { canvasToJpegBlob } from './cropImage';

export const UPLOAD_MAX_LONG_EDGE = 2560;
export const UPLOAD_JPEG_QUALITY = 0.82;

export interface TargetDimensions { width: number; height: number }

/** Long-edge clamp with no upscale; integer output. Pure — unit-tested. */
export function computeTargetDimensions(
  srcW: number,
  srcH: number,
  maxLongEdge = UPLOAD_MAX_LONG_EDGE,
): TargetDimensions {
  const scale = Math.min(1, maxLongEdge / Math.max(srcW, srcH));
  return { width: Math.round(srcW * scale), height: Math.round(srcH * scale) };
}

export interface PreprocessOpts { maxLongEdge?: number; quality?: number }

/**
 * Bake one upload blob: auto-orient (EXIF orientation applied by
 * createImageBitmap), downscale to <= maxLongEdge, re-encode JPEG. The canvas
 * redraw drops GPS/EXIF by construction. Returns a same-name *.jpg File.
 * Fails open (returns the input) when the canvas/bitmap path is unavailable;
 * the server env.IMAGES re-encode is the safety net for that case.
 */
export async function preprocessImage(file: File, opts: PreprocessOpts = {}): Promise<File> {
  const maxLongEdge = opts.maxLongEdge ?? UPLOAD_MAX_LONG_EDGE;
  const quality = opts.quality ?? UPLOAD_JPEG_QUALITY;
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return file; // decode failed (e.g. HEIC on a browser without support) — let the server strip it
  }
  try {
    const { width, height } = computeTargetDimensions(bitmap.width, bitmap.height, maxLongEdge);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await canvasToJpegBlob(canvas, quality);
    const baseName = (file.name || 'photo').replace(/\.[^.]+$/, '');
    return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg', lastModified: file.lastModified });
  } finally {
    bitmap.close();
  }
}
