/**
 * Upload preprocessing (backlog N2+N4) — one canvas bake per photo before
 * upload: downsample to a 2560 long edge, re-encode JPEG q=0.82, auto-orient
 * via createImageBitmap, and (by canvas redraw) discard ALL source metadata
 * including GPS/EXIF. This is the PRIMARY EXIF strip; the server env.IMAGES
 * re-encode in uploadPoolPhoto is the fallback for paths that skip this.
 */
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
