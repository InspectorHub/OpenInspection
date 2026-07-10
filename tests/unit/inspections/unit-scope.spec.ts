import { describe, it, expect } from 'vitest';
import { commonFindings, worstSeverityForUnit, defectCountsByUnit, buildUnitConditionMatrix } from '../../../server/lib/unit-scope';

const levels = [
  { id: 'g', label: 'Good', abbreviation: 'G', color: '#0a0', severity: 'good' as const, isDefect: false },
  { id: 'm', label: 'Marginal', abbreviation: 'M', color: '#fa0', severity: 'marginal' as const, isDefect: false },
  { id: 'd', label: 'Defect', abbreviation: 'D', color: '#a00', severity: 'significant' as const, isDefect: true },
];

const data = {
  '_default:exterior:roof': { rating: 'g' },
  'u1:kitchen:sink':  { rating: 'm' },
  'u1:bath:tub':      { rating: 'd', tabs: { defects: [{ cannedId: 'c', included: true, category: 'safety' }] } },
  'u2:kitchen:sink':  { rating: 'g' },
};

describe('unit-scope', () => {
  it('commonFindings returns only the _default slice', () => {
    expect(Object.keys(commonFindings(data))).toEqual(['_default:exterior:roof']);
  });

  it('worstSeverityForUnit picks the worst severity across a unit', () => {
    expect(worstSeverityForUnit('u1', data, levels)).toBe('significant');
    expect(worstSeverityForUnit('u2', data, levels)).toBe('good');
    expect(worstSeverityForUnit('u3', data, levels)).toBeNull();
  });

  it('defectCountsByUnit counts defect-level findings per unit', () => {
    expect(defectCountsByUnit([{ id: 'u1', label: '101' }, { id: 'u2', label: '102' }], data, levels))
      .toEqual({ u1: 1, u2: 0 });
  });

  it('builds a matrix with cells, category counts and exception flag', () => {
    const rows = buildUnitConditionMatrix(
      [{ id: 'u1', label: '101' }, { id: 'u2', label: '102' }],
      data, levels, ['kitchen', 'bath'],
    );
    const u1 = rows.find((r) => r.unitId === 'u1')!;
    expect(u1.cells['bath'].worst).toBe('significant');
    expect(u1.cells['bath'].counts.safety).toBe(1);
    expect(u1.isException).toBe(true);
    expect(rows.find((r) => r.unitId === 'u2')!.isException).toBe(false);
  });
});
