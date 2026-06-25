import { describe, it, expect } from 'vitest';
import { rangeIds } from '~/lib/editor/batch-range';
const ids = ['a','b','c','d'];
describe('rangeIds', () => {
  it('inclusive forward range', () => expect(rangeIds(ids,'a','c')).toEqual(['a','b','c']));
  it('inclusive reverse range (order-independent)', () => expect(rangeIds(ids,'c','a')).toEqual(['a','b','c']));
  it('single when from===to', () => expect(rangeIds(ids,'b','b')).toEqual(['b']));
  it('empty when an id is absent', () => expect(rangeIds(ids,'a','z')).toEqual([]));
});
