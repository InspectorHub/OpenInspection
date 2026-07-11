// Pins the payload-shaping contract: matrix + counts are built from unit rows +
// results in per_unit mode, empty otherwise. Uses the pure builders against
// report-shaped data (production wiring verified by getReportData + local E2E).
import { describe, it, expect } from 'vitest';
import { buildUnitConditionMatrix, defectCountsByUnit } from '../../../server/lib/unit-scope';

const levels = [
  { id: 'd', label: 'Defect', abbreviation: 'D', color: '#a00', severity: 'significant' as const, isDefect: true },
];

describe('report payload unit shaping', () => {
  it('per_unit builds matrix + counts; empty units yield [] / {}', () => {
    const data = { 'u1:roof:flash': { rating: 'd' } };
    const units = [{ id: 'u1', label: '101' }];
    expect(buildUnitConditionMatrix(units, data, levels, ['roof'])[0].isException).toBe(true);
    expect(defectCountsByUnit(units, data, levels)).toEqual({ u1: 1 });
    expect(buildUnitConditionMatrix([], data, levels, ['roof'])).toEqual([]);
    expect(defectCountsByUnit([], data, levels)).toEqual({});
  });
});
