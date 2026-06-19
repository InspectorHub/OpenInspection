import { describe, it, expect } from 'vitest';
import { resolvePhotoDisplayKey, clearAnnotationOnRecrop, type PhotoEntry } from '~/components/media-studio/photo-display-key';

describe('resolvePhotoDisplayKey', () => {
  it('prefers annotatedKey when present (annotated already contains the crop — sequential layering)', () => {
    const e: PhotoEntry = { key: 'orig.jpg', croppedKey: 'crop.jpg', annotatedKey: 'ann.png' };
    expect(resolvePhotoDisplayKey(e)).toBe('ann.png');
  });
  it('falls back to croppedKey when no annotation', () => {
    expect(resolvePhotoDisplayKey({ key: 'orig.jpg', croppedKey: 'crop.jpg' })).toBe('crop.jpg');
  });
  it('falls back to the original key when neither set', () => {
    expect(resolvePhotoDisplayKey({ key: 'orig.jpg' })).toBe('orig.jpg');
  });
});

describe('clearAnnotationOnRecrop', () => {
  it('drops annotatedKey + annotationsJson but keeps key (re-crop invalidates annotation coords)', () => {
    const next = clearAnnotationOnRecrop(
      { key: 'orig.jpg', croppedKey: 'old-crop.jpg', annotatedKey: 'ann.png', annotationsJson: '[{"kind":"circle"}]' },
      'new-crop.jpg',
      { aspect: 'free', orientation: 'landscape', x: 0, y: 0, width: 100, height: 80 },
    );
    expect(next.croppedKey).toBe('new-crop.jpg');
    expect(next.crop).toEqual({ aspect: 'free', orientation: 'landscape', x: 0, y: 0, width: 100, height: 80 });
    expect(next.annotatedKey).toBeUndefined();
    expect(next.annotationsJson).toBeUndefined();
    expect(next.key).toBe('orig.jpg');
  });
});
