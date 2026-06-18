import { describe, it, expect } from 'vitest';
import { moveEntry } from '../../server/lib/media/photo-ops';

describe('moveEntry', () => {
  const from = [{ key: 'a' }, { key: 'b', annotatedKey: 'b2' }, { key: 'c' }];
  const to = [{ key: 'x' }];
  it('removes the source index and appends it to the target, preserving derivatives', () => {
    const out = moveEntry(from, to, 1);
    expect(out.from.map(p => p.key)).toEqual(['a', 'c']);
    expect(out.to.map(p => p.key)).toEqual(['x', 'b']);
    expect(out.to[1]).toEqual({ key: 'b', annotatedKey: 'b2' }); // annotation rides along
  });
  it('throws when the source index is out of range', () => {
    expect(() => moveEntry(from, to, 9)).toThrow(/range/i);
  });
});
