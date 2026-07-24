import { describe, it, expect } from 'vitest';
import { flattenVersionDiff } from '~/routes/version-diff';

// IA-40 — the diff page rendered `data.map(...)`, but the diff API returns
// `{ items, units }` (an object), so the page crashed on every non-empty diff
// and only "worked" when there were zero changes. This flattener turns the real
// payload into the flat rows the table renders.
describe('flattenVersionDiff', () => {
  it('returns [] for a null/undefined payload', () => {
    expect(flattenVersionDiff(null)).toEqual([]);
    expect(flattenVersionDiff(undefined)).toEqual([]);
  });

  it('returns [] when there are no items or units', () => {
    expect(flattenVersionDiff({ items: [], units: { added: [], removed: [] } })).toEqual([]);
  });

  it('maps a changed field to before/after values', () => {
    const rows = flattenVersionDiff({
      items: [{ itemId: 'roof-1', kind: 'changed', field: 'rating', from: 'good', to: 'significant' }],
      units: { added: [], removed: [] },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ label: 'roof-1 · rating', change: 'changed', before: 'good', after: 'significant' });
  });

  it('marks added and removed items without inventing values', () => {
    const rows = flattenVersionDiff({
      items: [
        { itemId: 'attic-9', kind: 'added' },
        { itemId: 'deck-3', kind: 'removed' },
      ],
      units: { added: [], removed: [] },
    });
    expect(rows.find((r) => r.label === 'attic-9')).toMatchObject({ change: 'added', before: null, after: null });
    expect(rows.find((r) => r.label === 'deck-3')).toMatchObject({ change: 'removed', before: null, after: null });
  });

  it('includes added and removed units', () => {
    const rows = flattenVersionDiff({
      items: [],
      units: { added: [{ id: 'unit-b' }], removed: [{ id: 'unit-a' }] },
    });
    expect(rows.find((r) => r.change === 'added')?.label).toContain('unit-b');
    expect(rows.find((r) => r.change === 'removed')?.label).toContain('unit-a');
  });
});
