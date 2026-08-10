import { describe, it, expect } from 'vitest';
import {
  repairBuilderSectionProps,
  sortDefects,
  type Defect,
  type RepairRequest,
} from '../../../../app/components/portal/sections/RepairBuilderSection';

// Complete `Defect` / `RepairRequest` values rather than `{ findingKey: 'k' } as any`.
// The cast was not free: `Defect` grew `defectTitle`, `location` and `trade`
// (IA-55/IA-57) and these fixtures never noticed, so a sort or an adapter that
// started reading one of them would have read `undefined` here and passed.
const defect = (over: Partial<Defect> = {}): Defect => ({
  findingKey: 'k',
  sectionId: 's',
  sectionTitle: 'S',
  itemId: 'i',
  itemLabel: 'l',
  defectTitle: 'Cracked flashing',
  location: null,
  comment: '',
  category: 'safety',
  severityBucket: 'defect',
  trade: null,
  ...over,
});

describe('repairBuilderSectionProps', () => {
  it('passes defects + existing list through unchanged (identity, not just length)', () => {
    const defects: Defect[] = [defect({ findingKey: 'k' })];
    const mine: RepairRequest[] = [
      { id: 'r1', inspectionId: 'insp-1', tenantId: 't1', customIntro: null, shareToken: null },
    ];
    const p = repairBuilderSectionProps({ defects, mine });
    expect(p.defects).toBe(defects);
    expect(p.mine).toBe(mine);
    expect(p.defects[0].findingKey).toBe('k');
    expect(p.mine[0].id).toBe('r1');
  });
});

// IA-42 — "Severity" named two orthogonal axes. The sort now distinguishes the
// category axis (safety/recommendation/maintenance) from the real severity
// (rating) axis, and each has its own labeled option.
describe('sortDefects', () => {
  // `category` / `severityBucket` are the real unions, not `string`. Under the
  // old `(…: string) => … as any` signature a typo'd bucket compiled and sorted
  // to the `?? 9` fallback, which looks exactly like "sorts last on purpose".
  const mk = (
    findingKey: string,
    sectionTitle: string,
    category: Defect['category'],
    severityBucket: Defect['severityBucket'],
  ): Defect => defect({ findingKey, sectionTitle, category, severityBucket });

  it('category sort orders safety < recommendation < maintenance', () => {
    const d = [mk('a', 'Z', 'maintenance', 'monitor'), mk('b', 'A', 'safety', 'other'), mk('c', 'M', 'recommendation', 'defect')];
    expect(sortDefects(d, 'category').map((x) => x.category)).toEqual(['safety', 'recommendation', 'maintenance']);
  });

  it('severity sort orders by the rating axis, worst first and not-applicable last', () => {
    const d = [
      mk('a', 'A', 'safety', 'other'),
      mk('b', 'B', 'maintenance', 'defect'),
      mk('c', 'C', 'recommendation', 'monitor'),
      mk('d', 'D', 'safety', 'satisfactory'),
    ];
    expect(sortDefects(d, 'severity').map((x) => x.severityBucket)).toEqual(['defect', 'monitor', 'satisfactory', 'other']);
  });

  it('section sort orders by section title alphabetically', () => {
    const d = [mk('a', 'Roof', 'safety', 'defect'), mk('b', 'Attic', 'safety', 'defect')];
    expect(sortDefects(d, 'section').map((x) => x.sectionTitle)).toEqual(['Attic', 'Roof']);
  });
});
