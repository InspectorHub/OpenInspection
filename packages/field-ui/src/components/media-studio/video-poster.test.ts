/**
 * `posterKeyIfAdmissible` gates the first-frame poster of an R2 video: a poster the route would refuse (over the photo
 * ceiling, or not jpeg, png or webp by its bytes) is never sent, the person hears it once, and the video still finishes
 * without a poster (a poster is optional).
 */
import { describe, expect, it, vi } from 'vitest';
import { m } from '../../i18n';
import { MAX_PHOTO_BYTES } from '../../shared/photo-limits';
import { posterKeyIfAdmissible } from './video-poster';

const jpeg = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' });

describe('posterKeyIfAdmissible', () => {
  it('CONTROL - an admissible poster is uploaded and its key returned, silently', async () => {
    const upload = vi.fn(async () => ({ ok: true as const, data: { posterKey: 'p1' } }));
    const notify = vi.fn();
    expect(await posterKeyIfAdmissible(jpeg(), upload, notify)).toBe('p1');
    expect(upload).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
  });

  for (const [why, blob] of [
    ['over the ceiling', () => new Blob([new Uint8Array(MAX_PHOTO_BYTES + 1)])],
    ['not an image by its bytes', () => new Blob(['%PDF-1.7'], { type: 'image/jpeg' })],
  ] as const) {
    it(`a poster ${why} is not sent, is announced once with the fixed sentence, and yields no key`, async () => {
      const upload = vi.fn(async () => ({ ok: true as const, data: { posterKey: 'p1' } }));
      const notify = vi.fn();
      expect(await posterKeyIfAdmissible(blob(), upload, notify)).toBeUndefined();
      expect(upload).not.toHaveBeenCalled();
      expect(notify).toHaveBeenCalledTimes(1);
      expect(notify).toHaveBeenCalledWith(m.media_video_poster_skipped(), 'warning');
    });
  }

  it('a host that refuses the upload yields no key and no sentence of ours', async () => {
    const notify = vi.fn();
    expect(await posterKeyIfAdmissible(jpeg(), async () => ({ ok: false as const }), notify)).toBeUndefined();
    expect(notify).not.toHaveBeenCalled();
  });
});
