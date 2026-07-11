import { describe, it, expect } from 'vitest';
import { buildPhotoRefIndex, resolvePhotoRef } from '../../../server/lib/report-photos';
import type { AppendixPhoto } from '../../../server/lib/report-photos';

const appendix: AppendixPhoto[] = [
  { photoNo: 1, key: 'roof-1', url: '/p/roof-1', caption: null, sectionId: 's1', sectionTitle: 'Roof', itemId: 'i1', itemLabel: 'Covering' },
  { photoNo: 2, key: 'hvac-1', url: '/p/hvac-1', caption: null, sectionId: 's2', sectionTitle: 'HVAC', itemId: 'i2', itemLabel: 'Condenser' },
];

describe('reserve row photo back-reference', () => {
  it('resolves each reserve row photo_ref to its appendix photo_no', () => {
    const idx = buildPhotoRefIndex(appendix);
    const reserveRows = [
      { item: 'Roof recover', photoRef: 'roof-1' },
      { item: 'Condenser replace', photoRef: 'hvac-1' },
      { item: 'Lump-sum allowance', photoRef: null },
    ];
    const resolved = reserveRows.map((r) => ({ ...r, photoNo: resolvePhotoRef(idx, r.photoRef) }));
    expect(resolved.map((r) => r.photoNo)).toEqual([1, 2, null]);
  });
});
