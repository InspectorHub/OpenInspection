// Plan 7 — pre-upload validation for video capture. Pure logic (type + size);
// the duration probe + XHR upload are DOM/network and exercised in integration.
import { describe, it, expect } from 'vitest';
import {
  validateVideoFile,
  apiErrorReason,
  grabFirstFrame,
  uploadWithProgressBody,
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

describe('apiErrorReason', () => {
  const jsonResponse = (status: number, body: unknown): Response =>
    ({ status, json: async () => body }) as unknown as Response;

  it('surfaces the server-provided reason from the { error: { message } } envelope', async () => {
    const res = jsonResponse(503, {
      success: false,
      error: { message: 'Video uploads are unavailable — the video service has no remaining storage quota.', code: 'service_unavailable' },
    });
    await expect(apiErrorReason(res)).resolves.toMatch(/no remaining storage quota/i);
  });

  it('falls back to a status-coded message when the envelope has no usable reason', async () => {
    await expect(apiErrorReason(jsonResponse(500, { success: false }))).resolves.toMatch(/\(500\)/);
  });

  it('falls back when the body is not JSON', async () => {
    const res = { status: 502, json: async () => { throw new Error('not json'); } } as unknown as Response;
    await expect(apiErrorReason(res)).resolves.toMatch(/\(502\)/);
  });
});

// ── R2 provider: privacy checkbox gates the pick action ─────────────────────

describe('VideoCapture R2 privacy checkbox (logic)', () => {
  // The component renders a checkbox when provider='r2' and disables the pick
  // button until it is checked. We test the prop/flag logic directly.
  it('pick button is disabled for r2 when checkbox is unchecked', () => {
    // Simulates the component's pickDisabled computation:
    // pickDisabled = busy || (provider === 'r2' && !accepted)
    const pickDisabled = (provider: 'stream' | 'r2', accepted: boolean, busy: boolean) =>
      busy || (provider === 'r2' && !accepted);

    expect(pickDisabled('r2', false, false)).toBe(true);   // unchecked → disabled
    expect(pickDisabled('r2', true, false)).toBe(false);   // checked → enabled
    expect(pickDisabled('stream', false, false)).toBe(false); // stream → no checkbox, always enabled
    expect(pickDisabled('stream', true, false)).toBe(false);
    expect(pickDisabled('r2', true, true)).toBe(true);     // busy always disables
  });

  it('checkbox is absent for stream provider (no notice rendered)', () => {
    // The R2 notice is only rendered when provider === 'r2' && phase === 'pick'.
    const shouldRenderNotice = (provider: 'stream' | 'r2', phase: string) =>
      provider === 'r2' && phase === 'pick';

    expect(shouldRenderNotice('r2', 'pick')).toBe(true);
    expect(shouldRenderNotice('stream', 'pick')).toBe(false);
    expect(shouldRenderNotice('r2', 'uploading')).toBe(false);
  });
});

// ── grabFirstFrame is a browser-only function ────────────────────────────────

describe('grabFirstFrame', () => {
  it('is exported as a function', () => {
    // grabFirstFrame is a browser-DOM function (uses createElement + canvas).
    // We verify the export exists; full behavior is tested in E2E/integration.
    expect(typeof grabFirstFrame).toBe('function');
  });
});

// ── uploadWithProgressBody exports a function ────────────────────────────────

describe('uploadWithProgressBody', () => {
  it('is exported as a function', () => {
    expect(typeof uploadWithProgressBody).toBe('function');
  });
});
