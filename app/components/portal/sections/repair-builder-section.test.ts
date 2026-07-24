import { describe, it, expect } from 'vitest';
import { repairBuilderSectionProps, sortDefects } from '../../../../app/components/portal/sections/RepairBuilderSection';

describe('repairBuilderSectionProps', () => {
  it('passes defects + existing list through unchanged (identity, not just length)', () => {
    const defects = [{ findingKey: 'k' }] as any;
    const mine = [{ id: 'r1' }] as any;
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
  const mk = (findingKey: string, sectionTitle: string, category: string, severityBucket: string) =>
    ({ findingKey, sectionId: 's', sectionTitle, itemId: 'i', itemLabel: 'l', comment: '', category, severityBucket }) as any;

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
