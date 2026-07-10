import { describe, it, expect } from 'vitest';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { inspectionUnits, normalizeUnitAttrs } from '../../../server/lib/db/schema/units';

describe('UnitAttrs (Phase U — type + validator over the Phase F attrs column)', () => {
  it('normalizeUnitAttrs keeps known keys and drops empties', () => {
    expect(normalizeUnitAttrs({ unitType: '1BR/1BA', floor: '2', occupied: true }))
      .toEqual({ unitType: '1BR/1BA', floor: '2', occupied: true });
    expect(normalizeUnitAttrs({ unitType: '', floor: null } as never)).toEqual({});
    expect(normalizeUnitAttrs(null)).toEqual({});
  });

  it('the shared attrs column exists (created by Phase F Task 1) as nullable json, no FK, last', () => {
    const cfg = getTableConfig(inspectionUnits);
    const cols = Object.fromEntries(cfg.columns.map((c) => [c.name, c]));
    expect(cols['attrs']).toBeTruthy();          // ← Phase F dependency; absent = Phase F not landed
    expect(cols['attrs'].notNull).toBe(false);
    expect(cfg.foreignKeys.length).toBe(0);
    const names = cfg.columns.map((c) => c.name);
    expect(names[names.length - 1]).toBe('attrs');
  });
});
