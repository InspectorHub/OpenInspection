import { describe, it, expect } from 'vitest';
import { capturePriorRatings } from '~/lib/editor/batch-undo';

describe('capturePriorRatings', () => {
  it('captures current rating (or null) per item', () => {
    const current: Record<string, string | null> = { a: 'Satisfactory', b: null, c: 'Defect' };
    const out = capturePriorRatings(['a', 'b', 'c'], (id) => current[id] ?? null);
    expect(out).toEqual([
      { itemId: 'a', prior: 'Satisfactory' },
      { itemId: 'b', prior: null },
      { itemId: 'c', prior: 'Defect' },
    ]);
  });
  it('returns empty for no ids', () => expect(capturePriorRatings([], () => null)).toEqual([]));
});
