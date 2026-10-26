// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { DecodeImageError } from '../../decode-image';
import { bakeBatch, KEEP_ORIGINAL_MAX_BYTES } from './bakeBatch';

const text = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const heic = (name = 'a.heic') => new File([new Uint8Array([0, 0, 0, 16, ...text('ftypheic'), 0, 0, 0, 0])], name, { type: 'image/heic' });
const jpeg = (name = 'b.jpg') => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1])], name, { type: 'image/jpeg' });
const upright = () => new Blob(['full-size-jpeg'], { type: 'image/jpeg' });

afterEach(() => vi.unstubAllGlobals());

describe('bakeBatch with keep original on', () => {
  it('converts a HEIC at full size and highest quality up to 10 MiB, and leaves a JPEG untouched', async () => {
    const decodeImage = vi.fn(async () => ({ blob: upright() }));
    const photo = jpeg();
    const out = await bakeBatch([heic(), photo], true, decodeImage, vi.fn());
    expect(KEEP_ORIGINAL_MAX_BYTES).toBe(10 * 1024 * 1024);
    expect(decodeImage).toHaveBeenCalledTimes(1);
    expect(decodeImage).toHaveBeenCalledWith(expect.anything(), { keepOriginal: { maxBytes: KEEP_ORIGINAL_MAX_BYTES } });
    expect(out.map((f) => [f.name, f.type])).toEqual([['a.jpg', 'image/jpeg'], ['b.jpg', 'image/jpeg']]);
    expect(await out[0]!.text()).toBe('full-size-jpeg');
    expect(out[1]).toBe(photo);
  });

  it('CONTROL - without a decodeImage capability the HEIC is kept as picked', async () => {
    const input = heic();
    expect(await bakeBatch([input], true, undefined, vi.fn())).toEqual([input]);
  });

  it('keeps the file when the decoder declines (null) or fails with an ordinary error', async () => {
    const a = heic();
    const b = heic('c.heic');
    const out = await bakeBatch([a, b], true, vi.fn().mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('boom')), vi.fn());
    expect(out).toEqual([a, b]);
  });

  it('skips a file the decoder rejects with a DecodeImageError, reports it, and the rest of the batch goes through', async () => {
    const err = new DecodeImageError('CORRUPT', 'This photo is damaged.');
    const bad = heic('bad.heic');
    const good = jpeg();
    const onError = vi.fn();
    const decodeImage = vi.fn().mockRejectedValueOnce(err);
    const out = await bakeBatch([bad, good, jpeg('c.jpg')], true, decodeImage, onError);
    expect(out.map((f) => f.name)).toEqual(['b.jpg', 'c.jpg']);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(err, bad);
  });
});

describe('bakeBatch robustness', () => {
  it('keeps a file as picked when reading its bytes throws, and the rest of the batch proceeds', async () => {
    const unreadable = heic('unreadable.heic');
    Object.defineProperty(unreadable, 'slice', { value: () => ({ arrayBuffer: async () => { throw new Error('read failed'); } }) });
    const decodeImage = vi.fn(async () => ({ blob: upright() }));
    const onError = vi.fn();
    const out = await bakeBatch([unreadable, heic('ok.heic')], true, decodeImage, onError);
    expect(out.map((f) => f.name)).toEqual(['unreadable.heic', 'ok.jpg']);
    expect(onError).not.toHaveBeenCalled();
  });

  it('treats a DecodeImageError from another copy of the package as one (matched by name, not by class)', async () => {
    class ForeignCopy extends Error { override name = 'DecodeImageError'; }
    const onError = vi.fn();
    const out = await bakeBatch([heic('x.heic'), jpeg()], true, vi.fn().mockRejectedValueOnce(new ForeignCopy('Install the codec.')), onError);
    expect(out.map((f) => f.name)).toEqual(['b.jpg']);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('CONTROL - an error with another name is not reported and the file is kept', async () => {
    const onError = vi.fn();
    const input = heic('x.heic');
    const out = await bakeBatch([input], true, vi.fn().mockRejectedValueOnce(new TypeError('nope')), onError);
    expect(out).toEqual([input]);
    expect(onError).not.toHaveBeenCalled();
  });
});

describe('bakeBatch with keep original off', () => {
  it('reports a DecodeImageError from the bake, skips that file, keeps the others', async () => {
    vi.stubGlobal('createImageBitmap', async () => { throw new Error('unsupported'); });
    const err = new DecodeImageError('UNSUPPORTED', 'Install the codec.');
    const onError = vi.fn();
    const good = jpeg();
    const out = await bakeBatch([heic(), good], false, vi.fn().mockRejectedValueOnce(err), onError);
    expect(onError).toHaveBeenCalledWith(err, expect.anything());
    expect(out).toEqual([good]);
  });

  it('CONTROL - a bake that fails for another reason keeps the file and reports nothing', async () => {
    vi.stubGlobal('createImageBitmap', async () => { throw new Error('unsupported'); });
    const onError = vi.fn();
    const input = heic();
    const out = await bakeBatch([input], false, vi.fn().mockRejectedValue(new Error('boom')), onError);
    expect(out).toEqual([input]);
    expect(onError).not.toHaveBeenCalled();
  });
});
