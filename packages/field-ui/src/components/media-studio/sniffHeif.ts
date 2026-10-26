/** HEIF brands a browser usually cannot decode. `avif` is left out on purpose: browsers decode AVIF natively. */
const HEIF_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'hevm', 'hevs', 'mif1', 'msf1']);

/**
 * True when the first bytes are an ISO `ftyp` box whose major or compatible brand is a HEIF one. Reads the bytes, not
 * `File.type` or the extension, which can be empty or wrong.
 */
export async function looksLikeHeif(blob: Blob): Promise<boolean> {
  const bytes = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
  if (bytes.length < 12) return false;
  const ascii = (from: number) => String.fromCharCode(...bytes.subarray(from, from + 4));
  if (ascii(4) !== 'ftyp') return false;
  const major = ascii(8);
  if (major === 'avif' || major === 'avis') return false; // AVIF lists mif1 as a compatible brand
  if (HEIF_BRANDS.has(major)) return true;
  for (let at = 16; at + 4 <= bytes.length; at += 4) if (HEIF_BRANDS.has(ascii(at))) return true;
  return false;
}
