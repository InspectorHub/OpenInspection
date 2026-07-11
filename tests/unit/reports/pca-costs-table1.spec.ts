import { describe, it, expect } from 'vitest';
import { table1, bucketRollup, type CostItem } from '../../../server/lib/pca-costs';

function item(p: Partial<CostItem>): CostItem {
  return {
    id: p.id ?? 'x', system: p.system ?? 'roof', component: p.component ?? 'membrane',
    location: '', action: 'replace', costMethod: 'lump_sum', quantity: null, uom: null,
    unitCostCents: null, lumpSumCents: p.lumpSumCents ?? 0, eul: null, effAge: null, rul: p.rul ?? null,
    suggestedRemedy: '', bucket: p.bucket ?? 'immediate', sectionRef: null, photoRef: null,
    sortOrder: p.sortOrder ?? 0,
  };
}

describe('table1', () => {
  it('splits immediate vs short_term with per-bucket totals, sorted by sortOrder', () => {
    const t = table1([
      item({ id: 'b', bucket: 'immediate', lumpSumCents: 500000, sortOrder: 2 }),
      item({ id: 'a', bucket: 'immediate', lumpSumCents: 300000, sortOrder: 1 }),
      item({ id: 'c', bucket: 'short_term', lumpSumCents: 700000, sortOrder: 1 }),
      item({ id: 'd', bucket: 'long_term', lumpSumCents: 999900, sortOrder: 1 }), // ignored by table1
    ]);
    expect(t.immediate.map((r) => r.item.id)).toEqual(['a', 'b']);
    expect(t.immediateTotalCents).toBe(800000);
    expect(t.shortTerm.map((r) => r.item.id)).toEqual(['c']);
    expect(t.shortTermTotalCents).toBe(700000);
  });
});

describe('bucketRollup', () => {
  it('totals immediate / short_term / long_term (reserve)', () => {
    const r = bucketRollup([
      item({ bucket: 'immediate', lumpSumCents: 300000 }),
      item({ bucket: 'short_term', lumpSumCents: 700000 }),
      item({ bucket: 'long_term', lumpSumCents: 1200000 }),
    ]);
    expect(r).toEqual({ immediateCents: 300000, shortTermCents: 700000, reserveCents: 1200000 });
  });
});
