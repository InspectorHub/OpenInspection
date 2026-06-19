import { describe, it, expect } from 'vitest';
import { PhotoCropSchema } from '../../server/lib/validations/inspection.schema';

describe('PhotoCropSchema', () => {
  const base = { orientation: 'landscape', x: 0, y: 0, width: 1200, height: 800 };
  it('accepts a preset aspect', () => {
    expect(PhotoCropSchema.safeParse({ ...base, aspect: '3:2' }).success).toBe(true);
  });
  it('accepts free aspect (item/defect photos are not constrained like covers)', () => {
    expect(PhotoCropSchema.safeParse({ ...base, aspect: 'free' }).success).toBe(true);
  });
  it('rejects non-positive dims', () => {
    expect(PhotoCropSchema.safeParse({ ...base, aspect: 'free', width: 0 }).success).toBe(false);
  });
  it('rejects negative origin', () => {
    expect(PhotoCropSchema.safeParse({ ...base, aspect: 'free', x: -1 }).success).toBe(false);
  });
});
