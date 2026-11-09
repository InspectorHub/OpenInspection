import { describe, it, expect } from 'vitest';
import { collectAttachedPhotos } from '../../../server/lib/media/collect-attached';

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

  it('skips video entries: they are not photos and have no file key to show', () => {
    const data = { 'item-roof': {
      photos: [{ key: 'p0' }, { key: '', mediaType: 'video', provider: 'r2', mediaId: 'm1' }, { key: '', mediaType: 'video', streamUid: 'u1' }],
      tabs: { defects: { d1: { photos: [{ key: '', mediaType: 'video', provider: 'r2', mediaId: 'm2' }, { key: 'cd' }] } } },
    } } as never;
    const out = collectAttachedPhotos(data, meta, url);
    expect(out.map(p => p.originalKey)).toEqual(['p0', 'cd']);
  });

  it('carries the unit a finding belongs to, so a client can tell the units photos apart', () => {
    const data = { 'u1:sec-ext:item-roof': { photos: [{ key: 'one' }] }, 'u2:sec-ext:item-roof': { photos: [{ key: 'two' }] } };
    const parse = (k: string) => { const [unitId, sectionId, itemId] = k.split(':'); return { unitId, sectionId, itemId: itemId! }; };
    const out = collectAttachedPhotos(data, meta, url, parse);
    expect(out.map(p => [p.originalKey, p.unitId])).toEqual([['one', 'u1'], ['two', 'u2']]);
  });

  it('leaves unitId off when the key parser does not know one', () => {
    const out = collectAttachedPhotos({ 'item-roof': { photos: [{ key: 'a' }] } }, meta, url);
    expect(out[0]).not.toHaveProperty('unitId');
  });
});
