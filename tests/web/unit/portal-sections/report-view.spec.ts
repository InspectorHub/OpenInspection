import { describe, it, expect } from 'vitest';
import { reportViewProps } from '../../../../app/components/portal/sections/ReportView';
describe('ReportView extraction', () => {
  it('maps loader report payload to component props', () => {
    const p = reportViewProps({ sections: [], stats: { total: 0, satisfactory:0, monitor:0, defect:0 }, signature: null, verification: null, isPublished: false, brand: {} } as any);
    expect(p.isPublished).toBe(false);
    expect(Array.isArray(p.sections)).toBe(true);
  });
});
