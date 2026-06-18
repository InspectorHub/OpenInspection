import { describe, it, expect } from 'vitest';
import { stripExifOnIngest, type ImagesBinding } from '../../server/lib/media/strip-exif';

function fakeImages(outBytes: Uint8Array): ImagesBinding {
  return {
    input: () => ({
      transform: () => ({
        output: async () => ({
          response: () => new Response(outBytes, { headers: { 'content-type': 'image/jpeg' } }),
        }),
      }),
    }),
  } as unknown as ImagesBinding;
}

describe('stripExifOnIngest', () => {
  it('returns input unchanged when no IMAGES binding', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const out = await stripExifOnIngest(undefined, bytes, 'image/jpeg');
    expect(out.bytes).toBe(bytes);
    expect(out.contentType).toBe('image/jpeg');
  });

  it('re-encodes through the binding and returns stripped bytes', async () => {
    const stripped = new Uint8Array([9, 9, 9]);
    const out = await stripExifOnIngest(fakeImages(stripped), new Uint8Array([1, 2, 3]), 'image/jpeg');
    expect(new Uint8Array(out.bytes as ArrayBuffer | Uint8Array)).toEqual(stripped);
    expect(out.contentType).toBe('image/jpeg');
  });

  it('fails open (returns input) when the binding throws', async () => {
    const throwing = { input: () => { throw new Error('boom'); } } as unknown as ImagesBinding;
    const bytes = new Uint8Array([1, 2, 3]);
    const out = await stripExifOnIngest(throwing, bytes, 'image/jpeg');
    expect(out.bytes).toBe(bytes);
  });
});
