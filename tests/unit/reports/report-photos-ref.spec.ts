import { describe, it, expect } from 'vitest';
import { buildPhotoRefIndex, resolvePhotoRef } from '../../../server/lib/report-photos';
import type { AppendixPhoto } from '../../../server/lib/report-photos';

const appendix: AppendixPhoto[] = [
  { photoNo: 1, key: 'a', url: '/p/a', caption: null, sectionId: 's1', sectionTitle: 'Roof', itemId: 'i1', itemLabel: 'A' },
  { photoNo: 2, key: 'b', url: '/p/b', caption: null, sectionId: 's1', sectionTitle: 'Roof', itemId: 'i1', itemLabel: 'A' },
];

describe('photo_ref resolution', () => {
  it('resolves a ref to its assigned photo_no', () => {
    const idx = buildPhotoRefIndex(appendix);
    expect(resolvePhotoRef(idx, 'b')).toBe(2);
  });

  it('returns null for empty / unknown refs (no broken pointer)', () => {
    const idx = buildPhotoRefIndex(appendix);
    expect(resolvePhotoRef(idx, null)).toBeNull();
    expect(resolvePhotoRef(idx, '')).toBeNull();
    expect(resolvePhotoRef(idx, 'missing')).toBeNull();
  });
});
