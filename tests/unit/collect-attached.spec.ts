import { describe, it, expect } from 'vitest';
import { collectAttachedPhotos } from '../../server/lib/media/collect-attached';

const meta = new Map([['item-roof', { itemLabel: 'Roof', sectionId: 'sec-ext', sectionTitle: 'Exterior' }]]);
const url = (k: string) => `/u?key=${k}`;

describe('collectAttachedPhotos', () => {
  it('walks item photos and prefers annotatedKey as displayKey', () => {
    const data = { 'item-roof': { photos: [{ key: 'a' }, { key: 'b', annotatedKey: 'b-annot' }] } };
    const out = collectAttachedPhotos(data, meta, url);
    expect(out.map(p => p.key)).toEqual(['a', 'b-annot']);
    expect(out[1]).toMatchObject({ originalKey: 'b', annotated: true, itemId: 'item-roof', photoIndex: 1 });
  });

  it('includes canned-defect and custom-defect photos', () => {
    const data = { 'item-roof': {
      photos: [{ key: 'p0' }],
      tabs: { defects: { d1: { photos: [{ key: 'cd' }] } } },
      customComments: { defects: [{ id: 'cc1', photos: [{ key: 'xd', annotatedKey: 'xd-a' }] }] },
    } };
    const out = collectAttachedPhotos(data, meta, url);
    expect(out.map(p => p.key).sort()).toEqual(['cd', 'p0', 'xd-a'].sort());
    expect(out.find(p => p.originalKey === 'cd')).toMatchObject({ defectId: 'd1' });
    expect(out.find(p => p.originalKey === 'xd')).toMatchObject({ defectId: 'cc1', annotated: true });
  });

  it('skips malformed entries', () => {
    const data = { 'item-roof': { photos: [null, { nope: 1 }, { key: 'ok' }] } } as never;
    expect(collectAttachedPhotos(data, meta, url).map(p => p.originalKey)).toEqual(['ok']);
  });
});
