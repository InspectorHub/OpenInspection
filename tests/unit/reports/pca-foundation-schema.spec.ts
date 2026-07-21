// tests/unit/pca-foundation-schema.spec.ts
import { describe, it, expect } from 'vitest';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { inspections } from '../../../server/lib/db/schema';
import { inspectionUnits } from '../../../server/lib/db/schema/units';

describe('Commercial PCA Phase F foundation columns', () => {
  it('inspections gains unit_inspection_mode (default tagged) + location_options + sampling_declaration', () => {
    const cols = getTableConfig(inspections).columns;
    const byName = new Map(cols.map((c) => [c.name, c]));
    expect(byName.has('unit_inspection_mode')).toBe(true);
    expect(byName.has('location_options')).toBe(true);
    expect(byName.has('sampling_declaration')).toBe(true);
    expect(byName.get('unit_inspection_mode')?.default).toBe('tagged');
    expect(byName.get('unit_inspection_mode')?.notNull).toBe(true);
  });

  it('additive columns are appended at the end in order (OI #196 — no mid-list insert)', () => {
    // Phase F appended unit_inspection_mode/location_options/sampling_declaration;
    // Phase S then appended pca_narrative/deviations after them; Phase P then
    // appended report_photo_mode; A-polish 9b then appended the scheduled instant
    // trio; Report Style Presets (Plan 1a) then appended the badge_layout_override
    // + report_photo_columns tweak pair. All appended at the tail (never mid-list)
    // so db:generate emits ALTER ADD COLUMN, not a rebuild.
    const names = getTableConfig(inspections).columns.map((c) => c.name);
    const tail = names.slice(-11);
    expect(tail).toEqual([
      'unit_inspection_mode',
      'location_options',
      'sampling_declaration',
      'pca_narrative',
      'deviations',
      'report_photo_mode',
      'scheduled_start_ms',
      'scheduled_end_ms',
      'duration_min',
      'badge_layout_override',
      'report_photo_columns',
    ]);
  });

  it('inspection_units gains an attrs JSON column at the end (building-level attributes)', () => {
    const names = getTableConfig(inspectionUnits).columns.map((c) => c.name);
    expect(names).toContain('attrs');
    expect(names[names.length - 1]).toBe('attrs');
  });
});
