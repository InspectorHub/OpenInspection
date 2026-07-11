import { describe, it, expect } from 'vitest';
import { buildCostTables, type CostItem } from '../../../server/lib/pca-costs';

function item(p: Partial<CostItem>): CostItem {
  return {
    id: p.id ?? 'x', system: p.system ?? 'roof', component: p.component ?? 'membrane',
    location: '', action: 'replace', costMethod: 'lump_sum', quantity: null, uom: null,
    unitCostCents: null, lumpSumCents: p.lumpSumCents ?? 0, eul: null, effAge: null, rul: p.rul ?? null,
    suggestedRemedy: '', bucket: p.bucket ?? 'immediate', sectionRef: null, photoRef: null, sortOrder: 0,
  };
}

describe('cost reconciliation invariant', () => {
  it('ES rollup equals table1 totals + reserve total over kept items', () => {
    const items = [
      item({ id: 'i', bucket: 'immediate', lumpSumCents: 500000 }),
      item({ id: 's', bucket: 'short_term', lumpSumCents: 700000 }),
      item({ id: 'l', bucket: 'long_term', lumpSumCents: 1200000, rul: 3 }),
      item({ id: 'tiny', bucket: 'immediate', lumpSumCents: 100000 }), // dropped by threshold
    ];
    const out = buildCostTables(items, { reserveScheduleEnabled: true, reserveTermYears: 12, inflationRateBps: null }, 2026, 1000);
    // rollup is computed over KEPT items -> must match the rendered table totals
    expect(out.rollup.immediateCents).toBe(out.table1.immediateTotalCents);
    expect(out.rollup.shortTermCents).toBe(out.table1.shortTermTotalCents);
    expect(out.rollup.reserveCents).toBe(out.reserveSchedule!.totalUninflatedCents);
  });
});
