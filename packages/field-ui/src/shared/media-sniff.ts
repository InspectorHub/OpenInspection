/**
 * Decide an upload's real type from its first bytes. The declared Content-Type is client controlled, so a
 * client could store anything under an image or video key by labelling it; these functions look at the file
 * itself. Pure and bounded: callers pass at most `HEAD_BYTES` bytes (see `headBytes`), never the whole body.
 * The HEIF rule mirrors `looksLikeHeif` in packages/field-ui (browser side, async on a Blob).
 * Shared source: the server (`server/lib/media/sniff.ts` re-exports it) and the web pending store read the SAME rules,
 * so what the browser queues is exactly what the server will store.
 */
export const HEAD_BYTES = 64;

/** The leading bytes of an upload, read without buffering the rest. */
export async function headBytes(blob: Blob): Promise<Uint8Array> {
    return new Uint8Array(await blob.slice(0, HEAD_BYTES).arrayBuffer());
}

const text = (b: Uint8Array, at: number) => String.fromCharCode(...b.subarray(at, at + 4));
const startsWith = (b: Uint8Array, sig: number[]) => b.length >= sig.length && sig.every((v, i) => b[i] === v);

const STILL_IMAGE_MAJORS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'hevm', 'hevs', 'mif1', 'msf1', 'avif', 'avis']);
const HEIF_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'hevm', 'hevs', 'mif1', 'msf1']);
/** Brands of an ISO base media video: mp4 and its camera/phone variants, plus the 3GPP family (stored as mp4 too). */
const MP4_BRANDS = new Set([
    'isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'iso7', 'iso8', 'iso9', 'mp41', 'mp42', 'mp71', 'avc1', 'M4V ', 'M4VH', 'M4VP',
    'dash', 'mmp4', 'MSNV', 'XAVC', 'NDAS', 'f4v ', '3gp4', '3gp5', '3gp6', '3g2a', '3g2b', '3g2c',
]);

function sniffRaster(b: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | null {
    if (startsWith(b, [0xff, 0xd8, 0xff])) return 'image/jpeg';
    if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
    if (b.length >= 12 && text(b, 0) === 'RIFF' && text(b, 8) === 'WEBP') return 'image/webp';
    return null;
}

/**
 * The `ftyp` brands of an ISO base media file (major first, then the compatible list), or null when it is not one.
 * The box's own size field bounds the compatible brands; a size of 0 or 1, one under 12 or one past the window
 * means only the bytes inside the window are read.
 */
function ftypBrands(b: Uint8Array): string[] | null {
    if (b.length < 12 || text(b, 4) !== 'ftyp') return null;
    const size = ((b[0] ?? 0) * 0x1000000) + ((b[1] ?? 0) << 16) + ((b[2] ?? 0) << 8) + (b[3] ?? 0);
    const end = size >= 12 && size <= b.length ? size : b.length;
    const brands = [text(b, 8)];
    for (let at = 16; at + 4 <= end; at += 4) brands.push(text(b, at));
    return brands;
}

/** jpeg, png or heic by magic number; null for anything else (AVIF and WebP included). */
export function sniffPhotoType(b: Uint8Array): 'image/jpeg' | 'image/png' | 'image/heic' | null {
    const raster = sniffRaster(b);
    if (raster === 'image/jpeg' || raster === 'image/png') return raster;
    const brands = ftypBrands(b);
    if (!brands || brands[0] === 'avif' || brands[0] === 'avis') return null; // AVIF lists mif1 as compatible
    return brands.some((brand) => HEIF_BRANDS.has(brand)) ? 'image/heic' : null;
}

/** jpeg, png or webp by magic number: the types a video poster may be. */
export function sniffPosterType(b: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | null {
    return sniffRaster(b);
}

/** mp4 (any brand of the mp4 or 3GPP family, major or compatible), quicktime (`qt  ` major) or webm/Matroska; null for anything else. */
export function sniffVideoType(b: Uint8Array): 'video/mp4' | 'video/quicktime' | 'video/webm' | null {
    if (startsWith(b, [0x1a, 0x45, 0xdf, 0xa3])) return 'video/webm';
    const brands = ftypBrands(b);
    const major = brands?.[0];
    if (!brands || major === undefined || STILL_IMAGE_MAJORS.has(major)) return null; // an image is never a video
    if (major === 'qt  ') return 'video/quicktime';
    return brands.some((brand) => MP4_BRANDS.has(brand)) ? 'video/mp4' : null;
}
