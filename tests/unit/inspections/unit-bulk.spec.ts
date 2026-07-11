import { describe, it, expect } from 'vitest';
import { nextSortOrder, dedupeDrafts, copyName } from '../../../server/lib/unit-bulk';

describe('nextSortOrder', () => {
  it('starts at 0 when empty', () => expect(nextSortOrder([])).toBe(0));
  it('steps 10 past the current max', () =>
    expect(nextSortOrder([{ sortOrder: 0 }, { sortOrder: 20 }, { sortOrder: 10 }])).toBe(30));
});

describe('dedupeDrafts', () => {
  it('drops labels already present and intra-batch duplicates, order-preserving', () => {
    expect(dedupeDrafts(['101'], [
      { label: '101', floor: '1' },
      { label: '102', floor: '1' },
      { label: '102', floor: '1' },
      { label: '103', floor: '1' },
    ])).toEqual([
      { label: '102', floor: '1' },
      { label: '103', floor: '1' },
    ]);
  });
});

describe('copyName', () => {
  it('makes a collision-safe copy label', () => {
    expect(copyName('4B', ['4B'])).toBe('4B (copy)');
    expect(copyName('4B', ['4B', '4B (copy)'])).toBe('4B (copy 2)');
  });
});
