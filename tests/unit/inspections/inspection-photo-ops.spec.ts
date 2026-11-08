import { describe, it, expect } from 'vitest';
import { applyReorder, applyDetach, applyRevert } from '../../../server/lib/media/photo-ops';

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

describe('photo ops with video clips in the list (clips have no key)', () => {
  const clip = { key: '', mediaType: 'video' as const, provider: 'r2' as const, mediaId: 'm1', posterKey: 'p/k' };

  it('applyReorder permutes the keyed photos and leaves a clip where it is', () => {
    const out = applyReorder([{ key: 'a' }, clip, { key: 'b' }], ['b', 'a']);
    expect(out.map(p => p.mediaId ?? p.key)).toEqual(['b', 'm1', 'a']);
  });

  it('applyReorder refuses an order that names a clip or an empty ref, with a clear message', () => {
    expect(() => applyReorder([{ key: 'a' }, clip], ['a', 'm:m1'])).toThrow(/not a photo key/i);
    expect(() => applyReorder([{ key: 'a' }, clip], ['a', ''])).toThrow(/not a photo key/i);
    expect(() => applyReorder([{ key: 'a' }, clip], ['s:u1', 'a'])).toThrow(/not a photo key/i);
  });

  it('applyRevert does not rewrite a clip down to its key', () => {
    expect(() => applyRevert([clip], 0)).toThrow(/video/i);
  });
});

describe('applyReorder precision', () => {
  it('a real photo key that happens to start with m: is a photo key, not a clip reference', () => {
    const photos = [{ key: 'm:odd' }, { key: 'b' }];
    expect(applyReorder(photos, ['b', 'm:odd']).map(p => p.key)).toEqual(['b', 'm:odd']);
    expect(() => applyReorder(photos, ['b', 'm:odd', 'm:other'])).toThrow(/not a photo key/i);
  });

  it('refuses duplicate keys in the order with the mismatch error', () => {
    expect(() => applyReorder([{ key: 'a' }, { key: 'b' }], ['a', 'a'])).toThrow(/order mismatch/i);
  });
});
