import { describe, it, expect } from 'vitest';
import { filterCannedEntries, makeCustomDefect, appendCustomDefect } from '~/lib/custom-defects';

/**
 * B-20 — the Defects tab offered only the template's canned list: no search,
 * no way to add a finding in the field (the Roof Covering library has four
 * entries and no "water stain"). Custom defects persist under
 * `result.customComments.defects`, the shape the report renderer and
 * summary stats already consume (inspection.service.ts CustomDefect).
 */
describe('filterCannedEntries', () => {
  const entries = [
    { id: '1', title: 'Missing/Damaged Shingles', comment: 'Multiple shingles are missing, broken, or lifted.' },
    { id: '2', title: 'Active Leak', comment: 'Active roof leak observed; recommend immediate repair.' },
    { id: '3', title: 'End of Life', comment: 'Roof appears near end of expected service life.' },
  ];

  it('returns everything for an empty query', () => {
    expect(filterCannedEntries(entries, '')).toHaveLength(3);
    expect(filterCannedEntries(entries, '   ')).toHaveLength(3);
  });

  it('matches on title, case-insensitive', () => {
    expect(filterCannedEntries(entries, 'leak').map((e) => e.id)).toEqual(['2']);
  });

  it('matches on comment prose too', () => {
    expect(filterCannedEntries(entries, 'service life').map((e) => e.id)).toEqual(['3']);
  });

  it('returns empty when nothing matches', () => {
    expect(filterCannedEntries(entries, 'water stain')).toHaveLength(0);
  });
});

describe('makeCustomDefect', () => {
  it('builds an included defect with trimmed fields and defaults', () => {
    const d = makeCustomDefect(
      { title: '  Water stain at sheathing  ', comment: ' Staining near chimney. ' },
      () => 'cd_1',
    );
    expect(d).toEqual({
      id: 'cd_1',
      title: 'Water stain at sheathing',
      comment: 'Staining near chimney.',
      category: 'recommendation',
      included: true,
    });
  });

  it('honours an explicit category and optional location', () => {
    const d = makeCustomDefect(
      { title: 'Exposed wiring', category: 'safety', location: 'NE corner' },
      () => 'cd_2',
    );
    expect(d.category).toBe('safety');
    expect(d.location).toBe('NE corner');
  });

  it('returns null for a blank title', () => {
    expect(makeCustomDefect({ title: '   ' }, () => 'cd_3')).toBeNull();
  });
});

describe('appendCustomDefect', () => {
  it('appends into result.customComments.defects without mutating the original', () => {
    const result = { rating: 'Defect', notes: 'x' };
    const d = makeCustomDefect({ title: 'Water stain' }, () => 'cd_1')!;
    const next = appendCustomDefect(result, d);
    expect((next.customComments as { defects: unknown[] }).defects).toHaveLength(1);
    expect((result as Record<string, unknown>).customComments).toBeUndefined();
    expect(next.rating).toBe('Defect');
  });

  it('appends after existing custom defects', () => {
    const result = { customComments: { defects: [{ id: 'cd_0', title: 'Old', included: true }] } };
    const d = makeCustomDefect({ title: 'New one' }, () => 'cd_1')!;
    const next = appendCustomDefect(result, d);
    const defects = (next.customComments as { defects: Array<{ id: string }> }).defects;
    expect(defects.map((x) => x.id)).toEqual(['cd_0', 'cd_1']);
  });
});
