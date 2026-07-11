import { describe, it, expect } from 'vitest';
import { lineTotal, applyThreshold, type CostItem } from '../../../server/lib/pca-costs';

function item(p: Partial<CostItem>): CostItem {
  return {
    id: p.id ?? 'x', system: p.system ?? 'roof', component: p.component ?? 'membrane',
    location: p.location ?? '', action: p.action ?? 'replace',
    costMethod: p.costMethod ?? 'unit', quantity: p.quantity ?? null, uom: p.uom ?? null,
    unitCostCents: p.unitCostCents ?? null, lumpSumCents: p.lumpSumCents ?? null,
    eul: p.eul ?? null, effAge: p.effAge ?? null, rul: p.rul ?? null,
    suggestedRemedy: p.suggestedRemedy ?? '', bucket: p.bucket ?? 'immediate',
    sectionRef: p.sectionRef ?? null, photoRef: p.photoRef ?? null, sortOrder: p.sortOrder ?? 0,
  };
}

describe('lineTotal', () => {
  it('multiplies quantity by unit cost for the unit method', () => {
    expect(lineTotal(item({ costMethod: 'unit', quantity: 5, unitCostCents: 120000 }))).toBe(600000);
  });
  it('returns the lump sum for the lump_sum method', () => {
    expect(lineTotal(item({ costMethod: 'lump_sum', lumpSumCents: 450000 }))).toBe(450000);
  });
  it('treats null quantity/cost as 0', () => {
    expect(lineTotal(item({ costMethod: 'unit', quantity: null, unitCostCents: 120000 }))).toBe(0);
  });
});

describe('applyThreshold', () => {
  it('drops items below $3,000', () => {
    const r = applyThreshold([item({ id: 'a', costMethod: 'lump_sum', lumpSumCents: 250000 })]);
    expect(r.kept.map((i) => i.id)).toEqual([]);
    expect(r.dropped.map((i) => i.id)).toEqual(['a']);
  });
  it('keeps items at/above $3,000', () => {
    const r = applyThreshold([item({ id: 'a', costMethod: 'lump_sum', lumpSumCents: 300000 })]);
    expect(r.kept.map((i) => i.id)).toEqual(['a']);
  });
  it('keeps a like-group of 4+ totalling over $10,000 even when each is under $3,000', () => {
    const sub = (id: string) => item({ id, system: 'site', component: 'sealant', costMethod: 'lump_sum', lumpSumCents: 280000 });
    const r = applyThreshold([sub('a'), sub('b'), sub('c'), sub('d')]); // 4 x $2,800 = $11,200 > $10k
    expect(r.kept.map((i) => i.id).sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(r.dropped).toEqual([]);
  });
  it('does NOT rescue a like-group of only 3 under-threshold items', () => {
    const sub = (id: string) => item({ id, system: 'site', component: 'sealant', costMethod: 'lump_sum', lumpSumCents: 280000 });
    const r = applyThreshold([sub('a'), sub('b'), sub('c')]);
    expect(r.kept).toEqual([]);
    expect(r.dropped.map((i) => i.id).sort()).toEqual(['a', 'b', 'c']);
  });
  it('always keeps zero-cost further_study placeholders', () => {
    const r = applyThreshold([item({ id: 'fs', action: 'further_study', costMethod: 'lump_sum', lumpSumCents: null })]);
    expect(r.kept.map((i) => i.id)).toEqual(['fs']);
  });
});
