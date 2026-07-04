import { describe, it, expect } from 'vitest';
import {
  carriedItems,
  sectionsWithCarriedItems,
  isCarried,
} from '~/lib/reinspection-report';

// #119 (R7) — the re-inspection report must render ONLY the carried items
// (those with `original != null`). getReportData builds sections[].items from
// the FULL template snapshot, so non-carried items arrive with `original ==
// null` and must be filtered out; sections left with zero carried items must
// not render a header.

interface Item {
  id: string;
  label: string;
  original?: { rating: string | null; notes: string | null; photos: unknown[] } | null;
}
interface Section {
  id: string;
  name: string;
  items?: Item[];
}

// 1 carried item + 2 non-carried template items spread across 2 sections.
// Section "kitchen" has the single carried item; section "roof" has only
// non-carried items, so it must drop out entirely.
const fixture: Section[] = [
  {
    id: 'kitchen',
    name: 'Kitchen',
    items: [
      {
        id: 'item-a',
        label: 'Sink',
        original: { rating: 'defect', notes: 'leak', photos: [] },
      },
      { id: 'item-b', label: 'Cabinets', original: null },
    ],
  },
  {
    id: 'roof',
    name: 'Roof',
    items: [{ id: 'item-c', label: 'Shingles' }], // original undefined → not carried
  },
];

describe('reinspection-report helpers (#119 R7)', () => {
  it('isCarried is true only when original is present', () => {
    expect(isCarried({ original: { rating: null, notes: null, photos: [] } })).toBe(true);
    expect(isCarried({ original: null })).toBe(false);
    expect(isCarried({})).toBe(false);
  });

  it('carriedItems returns ONLY items with original != null', () => {
    const out = carriedItems(fixture);
    expect(out.map((i) => i.id)).toEqual(['item-a']);
  });

  it('sectionsWithCarriedItems narrows items and drops empty sections', () => {
    const out = sectionsWithCarriedItems(fixture);
    // The roof section (no carried items) is dropped — no empty header.
    expect(out.map((s) => s.id)).toEqual(['kitchen']);
    // The surviving section only keeps the carried item, not the template-only one.
    expect(out[0].items.map((i) => i.id)).toEqual(['item-a']);
  });
});
