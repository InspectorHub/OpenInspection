import { describe, it, expect } from 'vitest';
import { assignPhotoNumbers } from '../../../server/lib/report-photos';

const photo = (key: string, caption: string | null = null) => ({ key, url: `/p/${key}`, caption });

describe('assignPhotoNumbers', () => {
  it('assigns continuous 1-based numbers in render order (item photos then defect photos)', () => {
    const sections = [
      {
        id: 's1', title: 'Roof',
        items: [
          { id: 'i1', label: 'Covering', photos: [photo('a'), photo('b')], resolvedTabs: { defects: [{ defectPhotos: [photo('c')] }] } },
          { id: 'i2', label: 'Flashing', photos: [photo('d')], resolvedTabs: { defects: [] } },
        ],
      },
      {
        id: 's2', title: 'HVAC',
        items: [{ id: 'i3', label: 'Condenser', photos: [photo('e')], resolvedTabs: { defects: [] } }],
      },
    ];
    const { sections: numbered, appendix } = assignPhotoNumbers(sections as never);
    expect(appendix.map(p => [p.photoNo, p.key])).toEqual([
      [1, 'a'], [2, 'b'], [3, 'c'], [4, 'd'], [5, 'e'],
    ]);
    // stamps propagate back onto the section tree
    expect((numbered[0].items[0].photos as Array<{ photoNo: number }>)[0].photoNo).toBe(1);
    expect((numbered[0].items[0].resolvedTabs!.defects![0].defectPhotos as Array<{ photoNo: number }>)[0].photoNo).toBe(3);
  });

  it('is gap-free and dedupes a repeated key to one number', () => {
    const sections = [{
      id: 's1', title: 'Roof',
      items: [
        { id: 'i1', label: 'A', photos: [photo('dup')], resolvedTabs: { defects: [{ defectPhotos: [photo('dup')] }] } },
        { id: 'i2', label: 'B', photos: [photo('x')], resolvedTabs: { defects: [] } },
      ],
    }];
    const { appendix } = assignPhotoNumbers(sections as never);
    expect(appendix.map(p => p.key)).toEqual(['dup', 'x']);
    expect(appendix.map(p => p.photoNo)).toEqual([1, 2]); // no gaps despite the dedup
  });

  it('carries caption + section/item context into the appendix entry', () => {
    const sections = [{
      id: 's1', title: 'Roof',
      items: [{ id: 'i1', label: 'Covering', photos: [photo('a', 'Cracked tile, NE corner')], resolvedTabs: { defects: [] } }],
    }];
    const { appendix } = assignPhotoNumbers(sections as never);
    expect(appendix[0]).toMatchObject({
      photoNo: 1, key: 'a', caption: 'Cracked tile, NE corner',
      sectionId: 's1', sectionTitle: 'Roof', itemId: 'i1', itemLabel: 'Covering',
    });
  });

  it('returns an empty appendix when there are no photos', () => {
    const sections = [{ id: 's1', title: 'Roof', items: [{ id: 'i1', label: 'A', photos: [], resolvedTabs: { defects: [] } }] }];
    expect(assignPhotoNumbers(sections as never).appendix).toEqual([]);
  });
});
