/**
 * Media Studio (cover crop) — draw the chosen crop region of a source image to
 * a canvas and export a blob whose LONG edge is at most `maxLongEdge` (no
 * upscale). Source URL must be same-origin (authed photo route) so the canvas
 * is not tainted.
 */
export interface PixelCrop { x: number; y: number; width: number; height: number }

const MAX_LONG_EDGE = 2048;
/** Cap the in-memory DECODE long edge so a 20MB+ "original quality" photo can't OOM a tablet. */
const MAX_SOURCE_LONG_EDGE = 4096;
const JPEG_QUALITY = 0.82;

/**
 * What the bake is encoded as.
 *
 * PNG is not a preference, it is a REQUIREMENT for the two marks that get
 * composited onto a document: a signature and an association badge are cut out
 * against transparency, and JPEG has no alpha channel — it fills transparency
 * with white. Baking either as JPEG turns it into a white rectangle sitting on
 * the report cover, which reads as a rendering bug rather than a choice anyone
 * made. Photographs go on being JPEG, where the alpha channel buys nothing and
 * the file is a third of the size.
 */
export type BakeFormat = 'image/jpeg' | 'image/png';

/** Shared `canvas.toBlob` promise wrapper — rejects on null blob. */
function canvasToBlob(canvas: HTMLCanvasElement, format: BakeFormat, quality?: number): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), format, quality),
  );
}

/** JPEG encode — the upload-preprocess path, which never carries transparency. */
export function canvasToJpegBlob(canvas: HTMLCanvasElement, quality = JPEG_QUALITY): Promise<Blob> {
  return canvasToBlob(canvas, 'image/jpeg', quality);
}

/** Degrees folded into [0, 360). Negative input is what a "rotate left" button produces. */
export function normalizeRotation(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

/**
 * The bounding box a rotated image occupies.
 *
 * react-easy-crop reports the crop rect in the space of the ROTATED image, so
 * the bake has to reproduce that space exactly before it can index into it:
 * rotate the source into a canvas of these dimensions, then take the crop from
 * there. Getting this wrong does not throw — it silently returns a shifted
 * region, which is the failure mode where someone crops their signature and
 * gets a corner of the paper.
 */
export function rotatedBounds(width: number, height: number, degrees: number): { width: number; height: number } {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  return {
    width: Math.round(width * cos + height * sin),
    height: Math.round(width * sin + height * cos),
  };
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
  // A LOCAL source is left exactly as it is. `?w=` is an instruction to our
  // photo route to hand back a smaller variant; a `blob:` or `data:` URL has no
  // route behind it, and appending a query to a blob URL does not weaken the
  // request — it makes the URL resolve to nothing at all. That is how a
  // just-picked signature or badge failed to bake: the cropper displayed the
  // file happily (it renders the raw URL) and then Save did nothing, because
  // the only consumer of the mangled URL was the bake.
  if (/^(blob|data):/i.test(url)) return url;
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

export interface BakeCropOptions {
  /** Long-edge clamp on the OUTPUT (no upscale). */
  maxLongEdge?: number;
  /**
   * The FULL-resolution long edge of the source photo, so crop coords can be
   * rescaled when the CDN returns a bounded variant. Omit when the decode is
   * known to match the reported crop space.
   */
  sourceLongEdge?: number;
  /** Degrees the reader rotated the image by before choosing the crop. */
  rotation?: number;
  /** Output encoding — PNG wherever transparency has to survive. */
  format?: BakeFormat;
  /** JPEG quality; ignored for PNG (lossless). */
  quality?: number;
}

/**
 * Bake the chosen crop region to a blob (long edge <= maxLongEdge).
 *
 * The zero-rotation path is a single `drawImage` straight from the decoded
 * source, unchanged: every photo crop in the inspection editor takes it, and
 * the rotated path costs a second full-size canvas — real memory on the tablet
 * doing this in the field. Rotation only pays for itself when it is used.
 */
export async function bakeCrop(
  sourceUrl: string,
  crop: PixelCrop,
  { maxLongEdge = MAX_LONG_EDGE, sourceLongEdge, rotation = 0, format = 'image/jpeg', quality = JPEG_QUALITY }: BakeCropOptions = {},
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

  const turn = normalizeRotation(rotation);
  if (turn === 0) {
    ctx.drawImage(img, c.x, c.y, c.width, c.height, 0, 0, outW, outH);
  } else {
    // Reproduce the space the crop rect was measured in: the source rotated
    // about its centre, sized to its own bounding box. Only then does (x, y)
    // mean what the reader saw.
    const bounds = rotatedBounds(img.naturalWidth, img.naturalHeight, turn);
    const stage = document.createElement('canvas');
    stage.width = bounds.width;
    stage.height = bounds.height;
    const sctx = stage.getContext('2d');
    if (!sctx) throw new Error('canvas 2d context unavailable');
    sctx.translate(bounds.width / 2, bounds.height / 2);
    sctx.rotate((turn * Math.PI) / 180);
    sctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    ctx.drawImage(stage, c.x, c.y, c.width, c.height, 0, 0, outW, outH);
  }
  return await canvasToBlob(canvas, format, format === 'image/png' ? undefined : quality);
}
