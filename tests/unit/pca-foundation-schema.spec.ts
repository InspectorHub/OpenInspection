// tests/unit/pca-foundation-schema.spec.ts
import { describe, it, expect } from 'vitest';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { inspections } from '../../server/lib/db/schema';
import { inspectionUnits } from '../../server/lib/db/schema/units';

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

  it('the three inspections columns are appended at the end (OI #196 — no mid-list insert)', () => {
    const names = getTableConfig(inspections).columns.map((c) => c.name);
    const tail = names.slice(-3);
    expect(new Set(tail)).toEqual(
      new Set(['unit_inspection_mode', 'location_options', 'sampling_declaration']),
    );
  });

  it('inspection_units gains an attrs JSON column at the end (building-level attributes)', () => {
    const names = getTableConfig(inspectionUnits).columns.map((c) => c.name);
    expect(names).toContain('attrs');
    expect(names[names.length - 1]).toBe('attrs');
  });
});
