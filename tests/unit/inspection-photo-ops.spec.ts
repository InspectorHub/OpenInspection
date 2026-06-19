import { describe, it, expect } from 'vitest';
import { applyReorder, applyDetach, applyRevert } from '../../server/lib/media/photo-ops';

describe('applyReorder', () => {
  const photos = [{ key: 'a' }, { key: 'b' }, { key: 'c' }];
  it('reorders to the given key order', () => {
    expect(applyReorder(photos, ['c', 'a', 'b']).map(p => p.key)).toEqual(['c', 'a', 'b']);
  });
  it('rejects when the key set does not match (no add/drop via reorder)', () => {
    expect(() => applyReorder(photos, ['a', 'b'])).toThrow(/order mismatch/i);
    expect(() => applyReorder(photos, ['a', 'b', 'x'])).toThrow(/order mismatch/i);
  });
});

describe('applyDetach', () => {
  it('removes the entry at index', () => {
    expect(applyDetach([{ key: 'a' }, { key: 'b' }], 0).map(p => p.key)).toEqual(['b']);
  });
  it('throws out of range', () => { expect(() => applyDetach([{ key: 'a' }], 5)).toThrow(/range/); });
});

describe('applyRevert', () => {
  it('drops annotatedKey + annotationsJson, keeps key', () => {
    expect(applyRevert([{ key: 'a', annotatedKey: 'a2', annotationsJson: '[]' }], 0)[0]).toEqual({ key: 'a' });
  });
});
