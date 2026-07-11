import { describe, it, expect } from 'vitest';
import { reserveSchedule, type CostItem } from '../../../server/lib/pca-costs';

function lt(p: Partial<CostItem>): CostItem {
  return {
    id: p.id ?? 'x', system: p.system ?? 'mep', component: p.component ?? 'rtu',
    location: '', action: 'replace', costMethod: 'lump_sum', quantity: null, uom: null,
    unitCostCents: null, lumpSumCents: p.lumpSumCents ?? 0, eul: p.eul ?? null,
    effAge: p.effAge ?? null, rul: p.rul ?? null, suggestedRemedy: '',
    bucket: 'long_term', sectionRef: null, photoRef: null, sortOrder: p.sortOrder ?? 0,
  };
}

describe('reserveSchedule', () => {
  it('places replacement cost at currentYear + RUL and builds the year axis', () => {
    const s = reserveSchedule([lt({ id: 'a', rul: 3, lumpSumCents: 1000000 })], {
      currentYear: 2026, termYears: 12,
    });
    expect(s.startYear).toBe(2026);
    expect(s.years.length).toBe(12);
    expect(s.years[0]).toBe(2026);
    expect(s.years[11]).toBe(2037);
    expect(s.rows[0]!.placementYear).toBe(2029); // 2026 + 3
    expect(s.uninflatedByYear[3]).toBe(1000000); // index 3 == year 2029
    expect(s.totalUninflatedCents).toBe(1000000);
  });

  it('clamps RUL into [0, term-1]', () => {
    const s = reserveSchedule([
      lt({ id: 'neg', rul: -5, lumpSumCents: 500000 }),
      lt({ id: 'big', rul: 99, lumpSumCents: 700000 }),
    ], { currentYear: 2026, termYears: 12 });
    expect(s.rows.find((r) => r.item.id === 'neg')!.placementYear).toBe(2026); // clamp low
    expect(s.rows.find((r) => r.item.id === 'big')!.placementYear).toBe(2037); // clamp high (2026+11)
  });

  it('applies per-year inflation and a running cumulative', () => {
    // single item at year index 0 so inflation factor is 1 at i=0
    const s = reserveSchedule([lt({ id: 'a', rul: 0, lumpSumCents: 1000000 })], {
      currentYear: 2026, termYears: 3, inflationRateBps: 250, // 2.5%
    });
    expect(s.inflatedByYear[0]).toBe(1000000); // factor (1.025)^0 = 1
    expect(s.cumulativeInflatedByYear[0]).toBe(1000000);
    expect(s.cumulativeInflatedByYear[2]).toBe(1000000); // nothing added in later years
    expect(s.totalInflatedCents).toBe(1000000);
  });

  it('computes Per-SF metrics from building area, null when area missing', () => {
    const items = [lt({ id: 'a', rul: 0, lumpSumCents: 1200000 })];
    const withArea = reserveSchedule(items, { currentYear: 2026, termYears: 12, buildingAreaSqft: 1000 });
    expect(withArea.perSfUninflatedAllYears).toBe(1200); // 1,200,000 cents / 1000 sqft
    const noArea = reserveSchedule(items, { currentYear: 2026, termYears: 12, buildingAreaSqft: null });
    expect(noArea.perSfUninflatedAllYears).toBeNull();
  });
});
