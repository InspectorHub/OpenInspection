/**
 * Image Studio (cover crop) — draw the chosen crop region of a source image to
 * a canvas and export a JPEG blob whose LONG edge is at most `maxLongEdge` (no
 * upscale). Source URL must be same-origin (authed photo route) so the canvas
 * is not tainted.
 */
export interface PixelCrop { x: number; y: number; width: number; height: number }

const MAX_LONG_EDGE = 2048;
const JPEG_QUALITY = 0.82;

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

export async function bakeCrop(sourceUrl: string, crop: PixelCrop, maxLongEdge = MAX_LONG_EDGE): Promise<Blob> {
  const img = await loadImage(fullResUrl(sourceUrl));
  const scale = Math.min(1, maxLongEdge / Math.max(crop.width, crop.height));
  const outW = Math.round(crop.width * scale);
  const outH = Math.round(crop.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  ctx.drawImage(img, crop.x, crop.y, crop.width, crop.height, 0, 0, outW, outH);
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', JPEG_QUALITY),
  );
}
