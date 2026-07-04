import { describe, it, expect } from 'vitest';
import { attachPhotoToDefectState, attachPhotoToCustomDefect } from '~/lib/defect-photos';

/**
 * FE-3 — defect-level photos. The upload endpoint already accepts
 * targetType='defect' + customId (Sprint 1 A-7) and the report resolver
 * already maps `tabs.defects[].photos` → defectPhotos; what was missing is
 * the client writing the key into the right row. Canned-defect photos live
 * on the per-defect STATE row (result.tabs.defects[cannedId].photos),
 * custom-defect photos on result.customComments.defects[id].photos.
 */
describe('attachPhotoToDefectState', () => {
  it('appends to an existing defect state row', () => {
    const result = {
      rating: 'Defect',
      tabs: { defects: [{ cannedId: 'd1', included: true, photos: [{ key: 'a' }] }] },
    };
    const next = attachPhotoToDefectState(result, 'd1', 'b');
    const row = (next.tabs as { defects: Array<{ cannedId: string; photos: Array<{ key: string }> }> }).defects[0];
    expect(row.photos.map((p) => p.key)).toEqual(['a', 'b']);
    // immutable: original untouched
    expect((result.tabs.defects[0].photos as Array<{ key: string }>).length).toBe(1);
  });

  it('creates the state row (included=true) when the defect has no row yet', () => {
    const result = { rating: 'Defect' };
    const next = attachPhotoToDefectState(result, 'd9', 'k1');
    const rows = (next.tabs as { defects: Array<{ cannedId: string; included: boolean; photos: Array<{ key: string }> }> }).defects;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ cannedId: 'd9', included: true, photos: [{ key: 'k1' }] });
  });

  it('leaves other defect rows and other tabs alone', () => {
    const result = {
      tabs: {
        information: [{ cannedId: 'i1', included: false }],
        defects: [
          { cannedId: 'd1', included: true },
          { cannedId: 'd2', included: true, photos: [{ key: 'x' }] },
        ],
      },
    };
    const next = attachPhotoToDefectState(result, 'd1', 'new');
    const defects = (next.tabs as { defects: Array<{ cannedId: string; photos?: Array<{ key: string }> }> }).defects;
    expect(defects.find((d) => d.cannedId === 'd2')?.photos).toEqual([{ key: 'x' }]);
    expect((next.tabs as { information: unknown[] }).information).toHaveLength(1);
  });
});

describe('attachPhotoToCustomDefect', () => {
  it('appends to the matching custom defect only', () => {
    const result = {
      customComments: {
        defects: [
          { id: 'c1', title: 'Water stain', included: true },
          { id: 'c2', title: 'Other', included: true, photos: [{ key: 'p0' }] },
        ],
      },
    };
    const next = attachPhotoToCustomDefect(result, 'c1', 'p1');
    const defects = (next.customComments as { defects: Array<{ id: string; photos?: Array<{ key: string }> }> }).defects;
    expect(defects.find((d) => d.id === 'c1')?.photos).toEqual([{ key: 'p1' }]);
    expect(defects.find((d) => d.id === 'c2')?.photos).toEqual([{ key: 'p0' }]);
  });

  it('returns the result unchanged when the custom id is unknown', () => {
    const result = { customComments: { defects: [{ id: 'c1', title: 'X', included: true }] } };
    const next = attachPhotoToCustomDefect(result, 'nope', 'p1');
    expect(next).toEqual(result);
  });
});
