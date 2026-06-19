/**
 * Media Studio (cover crop) — draw the chosen crop region of a source image to
 * a canvas and export a JPEG blob whose LONG edge is at most `maxLongEdge` (no
 * upscale). Source URL must be same-origin (authed photo route) so the canvas
 * is not tainted.
 */
export interface PixelCrop { x: number; y: number; width: number; height: number }

const MAX_LONG_EDGE = 2048;
/** Cap the in-memory DECODE long edge so a 20MB+ "original quality" photo can't OOM a tablet. */
const MAX_SOURCE_LONG_EDGE = 4096;
export const JPEG_QUALITY = 0.82;

/** Shared `canvas.toBlob` promise wrapper — JPEG encode, rejects on null blob. */
export function canvasToJpegBlob(canvas: HTMLCanvasElement, quality = JPEG_QUALITY): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', quality),
  );
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

/** Strip a `?w=`/`&w=` thumbnail param so we bake from the full-resolution original. */
export function fullResUrl(url: string): string {
  return url.replace(/([?&])w=\d+(&|$)/, (_m, p1, p2) => (p2 === '&' ? p1 : '')).replace(/[?&]$/, '');
}

/**
 * Plan 4 Q5 — request a SIZED source variant (long edge <= maxEdge) instead of the
 * raw original, so the in-memory decode is bounded. Replaces any existing `?w=`
 * (never upscales past the cap) and otherwise appends `?w=`/`&w=` as appropriate.
 */
export function boundedSourceUrl(url: string, maxEdge = MAX_SOURCE_LONG_EDGE): string {
  const stripped = fullResUrl(url);
  return stripped.includes('?') ? `${stripped}&w=${maxEdge}` : `${stripped}?w=${maxEdge}`;
}

/**
 * Plan 4 Q5 — react-easy-crop reports crop pixels in source-image space. If the
 * CDN returned a downsized variant (decoded long edge < source long edge), scale
 * the crop rect by the same factor so it indexes the decoded bitmap correctly.
 */
export function scaleCropToDecoded(crop: PixelCrop, sourceLongEdge: number, decodedLongEdge: number): PixelCrop {
  const f = sourceLongEdge > 0 ? Math.min(1, decodedLongEdge / sourceLongEdge) : 1;
  if (f === 1) return crop;
  return {
    x: Math.round(crop.x * f),
    y: Math.round(crop.y * f),
    width: Math.round(crop.width * f),
    height: Math.round(crop.height * f),
  };
}

/**
 * Bake the chosen crop region to a JPEG blob (long edge <= maxLongEdge).
 *
 * @param sourceLongEdge  the FULL-resolution long edge of the source photo (so we
 *   can rescale crop coords when the CDN returns a bounded variant). When omitted
 *   we assume the decode matches the reported crop space (legacy cover path).
 */
export async function bakeCrop(
  sourceUrl: string,
  crop: PixelCrop,
  maxLongEdge = MAX_LONG_EDGE,
  sourceLongEdge?: number,
): Promise<Blob> {
  const img = await loadImage(boundedSourceUrl(sourceUrl));
  // The decoded bitmap may be smaller than the source the crop coords reference.
  const decodedLongEdge = Math.max(img.naturalWidth, img.naturalHeight);
  const c = sourceLongEdge != null
    ? scaleCropToDecoded(crop, sourceLongEdge, decodedLongEdge)
    : crop;
  const scale = Math.min(1, maxLongEdge / Math.max(c.width, c.height));
  const outW = Math.round(c.width * scale);
  const outH = Math.round(c.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  ctx.drawImage(img, c.x, c.y, c.width, c.height, 0, 0, outW, outH);
  return await canvasToJpegBlob(canvas, JPEG_QUALITY);
}
