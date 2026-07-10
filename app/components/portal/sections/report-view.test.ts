import { describe, it, expect } from 'vitest';
import { reportViewProps } from '../../../../app/components/portal/sections/ReportView';

describe('ReportView extraction', () => {
  it('carries populated loader fields through by value (not just presence/type)', () => {
    const sections = [{ id: 's1' }] as any;
    const stats = { total: 3, satisfactory: 1, monitor: 1, defect: 1 };
    const p = reportViewProps({
      sections, stats, signature: null, verification: null,
      isPublished: true, brand: { name: 'Acme' } as any,
      inspectionId: 'insp-1', address: '1 Main St', date: '2026-06-01',
      inspectorName: 'Jane Doe',
      unitInspectionMode: 'per_unit',
    } as any);
    expect(p.isPublished).toBe(true);
    expect(p.sections).toBe(sections);
    expect(p.stats).toEqual(stats);
    expect(p.inspectionId).toBe('insp-1');
    expect(p.reportId).toBe('insp-1'); // reportId derives from inspectionId
    expect(p.address).toBe('1 Main St');
    expect(p.inspectorName).toBe('Jane Doe');
    expect(p.unitInspectionMode).toBe('per_unit'); // Phase U mode carried through
  });

  it('falls back to safe defaults when fields are omitted (defensive against partial payloads)', () => {
    const p = reportViewProps({} as any);
    expect(p.sections).toEqual([]);
    expect(p.stats).toEqual({ total: 0, satisfactory: 0, monitor: 0, defect: 0 });
    expect(p.inspectionId).toBe('');
    expect(p.reportId).toBe('');
    expect(p.inspectorName).toBeNull();
    expect(p.isPublished).toBe(false);
    expect(p.initialFilter).toBe('all');
    expect(p.buildingProfile).toEqual([]);
    expect(p.pcaReport).toBeNull();
    // Phase U — default to 'tagged' so a non-per_unit report renders byte-identically
    // (the ReportView per-unit block is gated on unitInspectionMode === 'per_unit').
    expect(p.unitInspectionMode).toBe('tagged');
    expect(p.units).toEqual([]);
    expect(p.unitConditionMatrix).toEqual([]);
    expect(p.defectCountsByUnit).toEqual({});
  });
});
