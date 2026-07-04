import { describe, it, expect } from 'vitest';
import { computeOrphans, ORPHAN_GRACE_MS } from '../../../server/lib/media/orphan-gc';

const now = 1_000_000_000_000;

describe('computeOrphans', () => {
  it('records a newly-unreferenced key', () => {
    const live = new Set(['t/i/a']);
    const r2 = ['t/i/a', 't/i/b'];
    const out = computeOrphans(live, r2, new Map(), now, ORPHAN_GRACE_MS);
    expect(out.toRecord).toEqual(['t/i/b']);
    expect(out.toDelete).toEqual([]);
  });

  it('deletes only keys aged past the grace window', () => {
    const live = new Set(['t/i/a']);
    const r2 = ['t/i/a', 't/i/c', 't/i/d'];
    const seen = new Map([
      ['t/i/c', now - ORPHAN_GRACE_MS - 1],
      ['t/i/d', now - 1],
    ]);
    const out = computeOrphans(live, r2, seen, now, ORPHAN_GRACE_MS);
    expect(out.toDelete).toEqual(['t/i/c']);
  });

  it('clears a bookkeeping row whose key is referenced again', () => {
    const live = new Set(['t/i/a', 't/i/b']);
    const r2 = ['t/i/a', 't/i/b'];
    const seen = new Map([['t/i/b', now - ORPHAN_GRACE_MS - 1]]);
    const out = computeOrphans(live, r2, seen, now, ORPHAN_GRACE_MS);
    expect(out.toClear).toEqual(['t/i/b']);
  });
});
