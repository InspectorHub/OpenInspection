import { describe, it, expect } from 'vitest';
import { reportViewProps } from '../../../../app/components/portal/sections/ReportView';
import { EMPTY_BRAND } from '~/lib/brand';
import type { ReportLoaderResult, ReportSection } from './report/types';

/**
 * These fixtures are typed `Partial<ReportLoaderResult>` and asserted to the
 * full type at the call, rather than carrying `as any`.
 *
 * The distinction is the point of the file. `reportViewProps` defaults every
 * field it reads, so a PARTIAL payload is exactly what both cases here are
 * about — but `as any` bought that at the price of checking nothing at all, and
 * it was already hiding a dead fixture: the populated case passed
 * `brand: { name: 'Acme' }`, and `TenantBrand` has no `name`. It has
 * `companyName`. Under `Partial<T>` every key and value is still checked
 * against the real type; only the "all 40 fields present" requirement is
 * waived, which is the one thing these tests deliberately violate.
 */
describe('ReportView extraction', () => {
  it('carries populated loader fields through by value (not just presence/type)', () => {
    const sections: ReportSection[] = [{ id: 's1', title: 'Roof', defectCount: 0, items: [] }];
    const stats = { total: 3, satisfactory: 1, monitor: 1, defect: 1 };
    const data: Partial<ReportLoaderResult> = {
      sections, stats, signature: null, verification: null,
      isPublished: true, brand: { ...EMPTY_BRAND, companyName: 'Acme' },
      inspectionId: 'insp-1', address: '1 Main St', date: '2026-06-01',
      inspectorName: 'Jane Doe',
      unitInspectionMode: 'per_unit',
    };
    const p = reportViewProps(data as ReportLoaderResult);
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
    const empty: Partial<ReportLoaderResult> = {};
    const p = reportViewProps(empty as ReportLoaderResult);
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
