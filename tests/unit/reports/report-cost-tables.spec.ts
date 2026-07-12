import { describe, it, expect } from 'vitest';
import { buildCostTables, type CostItem } from '../../../server/lib/pca-costs';

function item(p: Partial<CostItem>): CostItem {
  return {
    id: p.id ?? 'x', system: p.system ?? 'roof', component: p.component ?? 'membrane',
    location: '', action: p.action ?? 'replace', costMethod: 'lump_sum', quantity: null, uom: null,
    unitCostCents: null, lumpSumCents: p.lumpSumCents ?? 0, eul: null, effAge: null, rul: p.rul ?? null,
    suggestedRemedy: '', bucket: p.bucket ?? 'immediate', sectionRef: null, photoRef: null, sortOrder: 0,
  };
}

describe('buildCostTables', () => {
  it('builds table1 + rollup, omits reserve when disabled, applies threshold', () => {
    const items = [
      item({ id: 'a', bucket: 'immediate', lumpSumCents: 500000 }),
      item({ id: 'tiny', bucket: 'immediate', lumpSumCents: 100000 }), // < $3k -> dropped
      item({ id: 'r', bucket: 'long_term', lumpSumCents: 1200000, rul: 4 }),
    ];
    const out = buildCostTables(items, { reserveScheduleEnabled: false, reserveTermYears: 12, inflationRateBps: null }, 2026, 1000);
    expect(out.table1.immediate.map((row) => row.item.id)).toEqual(['a']); // tiny dropped
    expect(out.droppedCount).toBe(1);
    expect(out.reserveSchedule).toBeNull();
    // rollup is over kept items
    expect(out.rollup.immediateCents).toBe(500000);
    expect(out.rollup.reserveCents).toBe(1200000);
  });

  it('emits the reserve schedule when enabled', () => {
    const out = buildCostTables(
      [item({ id: 'r', bucket: 'long_term', lumpSumCents: 1200000, rul: 4 })],
      { reserveScheduleEnabled: true, reserveTermYears: 12, inflationRateBps: 250 }, 2026, 1000,
    );
    expect(out.reserveSchedule).not.toBeNull();
    expect(out.reserveSchedule!.years[0]).toBe(2026);
    expect(out.reserveSchedule!.rows[0]!.placementYear).toBe(2030);
  });

  it('omits the reserve schedule when enabled but there are no long-term items', () => {
    // Regression: an enabled-but-empty reserve schedule rendered a bare TABLE 2
    // (headers + $0 totals) even with zero long-term items — e.g. on every
    // report of a tenant that turned the flag on. Emit it only when it has rows.
    const out = buildCostTables(
      [item({ id: 'i', bucket: 'immediate', lumpSumCents: 500000 })],
      { reserveScheduleEnabled: true, reserveTermYears: 12, inflationRateBps: 250 }, 2026, 1000,
    );
    expect(out.reserveSchedule).toBeNull();
  });
});
