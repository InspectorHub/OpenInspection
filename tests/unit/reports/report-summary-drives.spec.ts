import { describe, it, expect } from 'vitest';
import { defectDrivesSummary } from '../../../server/services/inspection/inspection-report.service';

/**
 * Authoring unification Plan-4 module K — `CannedDefect.category` widened
 * from a hard-coded enum to a tenant defect_categories reference. The report
 * Summary rollup no longer keys off `category === 'safety'`; it resolves the
 * category to a tenant row (by id OR name — seed template JSON stores the
 * legacy names) and reads that row's `drivesSummary` flag.
 */
describe('defectDrivesSummary', () => {
  const cats = [
    { id: 'maintenance', name: 'maintenance', drivesSummary: false },
    { id: 'safety', name: 'safety', drivesSummary: true },
  ];
  it('includes a safety defect and excludes a maintenance one', () => {
    expect(defectDrivesSummary('safety', cats)).toBe(true);
    expect(defectDrivesSummary('maintenance', cats)).toBe(false);
  });
  it('defaults to true for an unresolved category (never silently drops)', () => {
    expect(defectDrivesSummary('unknown-id', cats)).toBe(true);
  });
  it('defaults to true for an absent category', () => {
    expect(defectDrivesSummary(null, cats)).toBe(true);
    expect(defectDrivesSummary(undefined, cats)).toBe(true);
  });
  it('resolves by defect_categories.id as well as by legacy seed name', () => {
    const custom = [{ id: 'cat-uuid-1', name: 'Cosmetic', drivesSummary: false }];
    expect(defectDrivesSummary('cat-uuid-1', custom)).toBe(false);
  });
});
