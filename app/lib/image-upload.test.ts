/**
 * The gate every image on Settings → Profile passes before a cropper opens.
 *
 * These three surfaces — profile photo, signature, badge — used to disagree
 * about what they accepted and about what they did with it. The point of a
 * shared check is that a 3 MB file is refused the same way, with the same
 * sentence, whichever control the reader used.
 */
import { describe, it, expect } from 'vitest';
import {
  IMAGE_UPLOAD_MAX_BYTES,
  isVectorImage,
  validateImageFile,
} from '~/lib/image-upload';

function fileOf(type: string, size = 1000): File {
  const f = new File([new Uint8Array(1)], 'x', { type });
  // File size is derived from its parts; override it rather than allocating
  // two megabytes of zeroes to test a limit.
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

describe('validateImageFile', () => {
  it('accepts the four formats every one of these surfaces takes', () => {
    for (const t of ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']) {
      expect(validateImageFile(fileOf(t))).toBeNull();
    }
  });

  it('refuses a format the server would refuse anyway, with a reason', () => {
    // The server also rejects this. Doing it here is what turns "the button
    // did nothing" into a sentence naming the formats that work.
    const msg = validateImageFile(fileOf('image/gif'));
    expect(msg).toBeTruthy();
    expect(msg).toMatch(/PNG/i);
  });

  it('refuses a file over the limit the server enforces', () => {
    const msg = validateImageFile(fileOf('image/png', IMAGE_UPLOAD_MAX_BYTES + 1));
    expect(msg).toBeTruthy();
    expect(msg).toMatch(/2 MB/i);
  });

  it('accepts a file exactly at the limit — the server does', () => {
    // Off-by-one here would refuse a file the API accepts, which is worse than
    // no check at all: the reader is told no by a page that would have said yes.
    expect(validateImageFile(fileOf('image/png', IMAGE_UPLOAD_MAX_BYTES))).toBeNull();
  });
});

describe('isVectorImage', () => {
  it('is true only for SVG', () => {
    // SVG skips the cropper on purpose: drawing it to a canvas to crop it
    // rasterizes it at one fixed size and discards the only property that made
    // it worth uploading as a vector.
    expect(isVectorImage(fileOf('image/svg+xml'))).toBe(true);
    expect(isVectorImage(fileOf('image/png'))).toBe(false);
    expect(isVectorImage(fileOf('image/jpeg'))).toBe(false);
  });
});
