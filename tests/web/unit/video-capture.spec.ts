// Plan 7 — pre-upload validation for video capture. Pure logic (type + size);
// the duration probe + XHR upload are DOM/network and exercised in integration.
import { describe, it, expect } from 'vitest';
import {
  validateVideoFile,
  MAX_VIDEO_BYTES,
  MAX_VIDEO_SEC,
  ALLOWED_VIDEO_TYPES,
} from '~/components/media-studio/VideoCapture';

function fakeFile(type: string, size: number): File {
  const file = new File([new Uint8Array(0)], 'clip', { type });
  // Override the computed size (the byte array is empty to keep the test cheap).
  Object.defineProperty(file, 'size', { value: size, configurable: true });
  return file;
}

describe('validateVideoFile', () => {
  it('accepts the allowed types under the size cap', () => {
    for (const t of ALLOWED_VIDEO_TYPES) {
      expect(validateVideoFile(fakeFile(t, 5 * 1024 * 1024))).toBeNull();
    }
  });

  it('rejects an unsupported format', () => {
    expect(validateVideoFile(fakeFile('video/avi', 1000))).toMatch(/format/i);
    expect(validateVideoFile(fakeFile('image/png', 1000))).toMatch(/format/i);
  });

  it('rejects a file over the 200 MB cap', () => {
    expect(validateVideoFile(fakeFile('video/mp4', MAX_VIDEO_BYTES + 1))).toMatch(/too large/i);
  });

  it('accepts exactly the cap', () => {
    expect(validateVideoFile(fakeFile('video/mp4', MAX_VIDEO_BYTES))).toBeNull();
  });

  it('exposes a 30s duration cap', () => {
    expect(MAX_VIDEO_SEC).toBe(30);
  });
});
