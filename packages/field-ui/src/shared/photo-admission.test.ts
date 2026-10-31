/**
 * `photoRefusal` is the one admission check for every image the editor produces or the person picks: the size ceiling
 * and the type decided by the leading bytes, never the declared type. A control pins that an admissible image passes.
 */
import { describe, expect, it } from 'vitest';
import { photoRefusal, posterRefusal } from './photo-admission';
import { MAX_PHOTO_BYTES } from './photo-limits';

const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe('photoRefusal', () => {
  it('admits a jpeg and a png by their bytes', async () => {
    expect(await photoRefusal(new Blob([new Uint8Array(JPEG)], { type: 'image/jpeg' }))).toBeNull();
    expect(await photoRefusal(new Blob([new Uint8Array(PNG)], { type: 'image/png' }))).toBeNull();
  });

  it('admits a body exactly at the ceiling and refuses one byte over it', async () => {
    const at = new Uint8Array(MAX_PHOTO_BYTES);
    at.set(JPEG);
    expect(await photoRefusal(new Blob([at]))).toBeNull();
    const over = new Uint8Array(MAX_PHOTO_BYTES + 1);
    over.set(JPEG);
    expect(await photoRefusal(new Blob([over]))).toBe('TOO_LARGE');
  });

  it('refuses bytes that are not an image, whatever the blob claims to be', async () => {
    expect(await photoRefusal(new Blob(['%PDF-1.7'], { type: 'image/jpeg' }))).toBe('UNSUPPORTED_TYPE');
    expect(await photoRefusal(new Blob([], { type: 'image/png' }))).toBe('UNSUPPORTED_TYPE');
  });

  it('reports the size before the type, as the server does', async () => {
    expect(await photoRefusal(new Blob([new Uint8Array(MAX_PHOTO_BYTES + 1)]))).toBe('TOO_LARGE');
  });
});

describe('posterRefusal', () => {
  const WEBP = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];
  const HEIC = [0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63];

  it('admits the types the poster route stores (jpeg, png, webp) and refuses the rest, by bytes', async () => {
    for (const head of [JPEG, PNG, WEBP]) expect(await posterRefusal(new Blob([new Uint8Array(head)]))).toBeNull();
    expect(await posterRefusal(new Blob([new Uint8Array(HEIC)]))).toBe('UNSUPPORTED_TYPE');
    expect(await posterRefusal(new Blob(['%PDF-1.7'], { type: 'image/jpeg' }))).toBe('UNSUPPORTED_TYPE');
  });

  it('uses the same ceiling as a photo: at it is fine, one byte over is too large', async () => {
    const at = new Uint8Array(MAX_PHOTO_BYTES);
    at.set(JPEG);
    expect(await posterRefusal(new Blob([at]))).toBeNull();
    expect(await posterRefusal(new Blob([new Uint8Array(MAX_PHOTO_BYTES + 1)]))).toBe('TOO_LARGE');
  });
});
