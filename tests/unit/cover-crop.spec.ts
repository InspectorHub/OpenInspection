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

import { CoverCropSchema } from '../../server/lib/validations/inspection.schema';
describe('CoverCropSchema', () => {
  const valid = { aspect: '3:2', orientation: 'landscape', x: 0, y: 0, width: 1200, height: 800 };
  it('accepts valid', () => { expect(CoverCropSchema.safeParse(valid).success).toBe(true); });
  it('rejects unknown aspect', () => { expect(CoverCropSchema.safeParse({ ...valid, aspect: '5:4' }).success).toBe(false); });
  it('rejects non-positive dims', () => { expect(CoverCropSchema.safeParse({ ...valid, width: 0 }).success).toBe(false); });
});
