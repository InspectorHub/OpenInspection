import { describe, it, expect } from 'vitest';
import { resolveCoverUrl } from '../../server/services/inspection.service';
describe('resolveCoverUrl', () => {
  const make = (k: string) => `/api/photo/${k}`;
  it('prefers the baked cover_image_key when present', () => {
    expect(resolveCoverUrl({ coverImageKey: 'baked.jpg', coverPhotoId: 'src.jpg' }, make)).toBe('/api/photo/baked.jpg');
  });
  it('falls back to cover_photo_id', () => {
    expect(resolveCoverUrl({ coverImageKey: null, coverPhotoId: 'src.jpg' }, make)).toBe('/api/photo/src.jpg');
  });
  it('null when neither set', () => {
    expect(resolveCoverUrl({ coverImageKey: null, coverPhotoId: null }, make)).toBeNull();
  });
});
