// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { DecodeImageError } from '../../decode-image';
import { preprocessImage } from './preprocessImage';

function ftyp(major: string): Uint8Array<ArrayBuffer> {
  const text = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
  return new Uint8Array([0, 0, 0, 16, ...text('ftyp'), ...text(major), 0, 0, 0, 0]);
}
const heic = () => new File([ftyp('heic')], 'IMG_1.heic', { type: 'image/heic' });
const brokenPng = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])], 'x.png', { type: 'image/png' });
const decodedJpeg = () => new Blob(['decoded'], { type: 'image/jpeg' });

type BitmapCall = { source: Blob; options: ImageBitmapOptions | undefined };
let calls: BitmapCall[];
/** The first call (the native decode) fails; later calls succeed, unless `nativeWorks`. */
function stubBitmap(nativeWorks = false) {
  calls = [];
  vi.stubGlobal('createImageBitmap', async (source: Blob, options?: ImageBitmapOptions) => {
    calls.push({ source, options });
    if (!nativeWorks && calls.length === 1) throw new Error('unsupported');
    return { width: 800, height: 600, close: () => undefined };
  });
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: () => undefined } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => cb(new Blob(['baked'], { type: 'image/jpeg' })));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('preprocessImage with a decodeImage capability', () => {
  it('calls decodeImage only after the native decode fails, and bakes what it returns', async () => {
    stubBitmap();
    const decodeImage = vi.fn(async () => ({ blob: decodedJpeg() }));
    const input = heic();
    const out = await preprocessImage(input, { decodeImage });
    expect(decodeImage).toHaveBeenCalledTimes(1);
    expect(decodeImage).toHaveBeenCalledWith(input, { maxLongEdge: 2560 });
    expect(out).not.toBe(input);
    expect(out.name).toBe('IMG_1.jpg');
    expect(out.type).toBe('image/jpeg');
  });

  it('CONTROL - does not call decodeImage when the native decode succeeds', async () => {
    stubBitmap(true);
    const decodeImage = vi.fn(async () => ({ blob: decodedJpeg() }));
    const out = await preprocessImage(heic(), { decodeImage });
    expect(decodeImage).not.toHaveBeenCalled();
    expect(out.type).toBe('image/jpeg');
  });

  it('does not call decodeImage for a non-HEIF file even when the native decode fails', async () => {
    stubBitmap();
    const decodeImage = vi.fn(async () => ({ blob: decodedJpeg() }));
    const input = brokenPng();
    expect(await preprocessImage(input, { decodeImage })).toBe(input);
    expect(decodeImage).not.toHaveBeenCalled();
  });

  it('returns the input unchanged when decodeImage is absent (and the HEIF probe is what ran for the control)', async () => {
    stubBitmap();
    const input = heic();
    expect(await preprocessImage(input)).toBe(input);
    expect(calls).toHaveLength(1);
  });

  it('returns the input unchanged when decodeImage resolves null', async () => {
    stubBitmap();
    const input = heic();
    expect(await preprocessImage(input, { decodeImage: async () => null })).toBe(input);
    expect(calls).toHaveLength(1);
  });

  it('rethrows a DecodeImageError instead of returning the HEIC', async () => {
    stubBitmap();
    const err = new DecodeImageError('UNSUPPORTED', 'Install the codec');
    await expect(preprocessImage(heic(), { decodeImage: async () => { throw err; } })).rejects.toBe(err);
  });

  it('applies no orientation to the decoder blob (it is already upright) but still orients the native decode', async () => {
    stubBitmap();
    await preprocessImage(heic(), { decodeImage: async () => ({ blob: decodedJpeg() }) });
    expect(calls[0]!.options).toEqual({ imageOrientation: 'from-image' });
    expect(calls[1]!.options).toEqual({ imageOrientation: 'none' });
  });
});
