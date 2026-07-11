import { describe, it, expect } from 'vitest';
import { costItemsToCsv, type CostItem } from '../../../server/lib/pca-costs';

function item(p: Partial<CostItem>): CostItem {
  return {
    id: p.id ?? 'a', system: p.system ?? 'roof', component: p.component ?? 'membrane',
    location: p.location ?? '', action: 'replace', costMethod: p.costMethod ?? 'unit',
    quantity: p.quantity ?? 5, uom: p.uom ?? 'sf', unitCostCents: p.unitCostCents ?? 120000,
    lumpSumCents: p.lumpSumCents ?? null, eul: null, effAge: null, rul: null,
    suggestedRemedy: p.suggestedRemedy ?? '', bucket: p.bucket ?? 'immediate',
    sectionRef: null, photoRef: null, sortOrder: 0,
  };
}

describe('costItemsToCsv', () => {
  it('emits a header + derived total_cents', () => {
    const csv = costItemsToCsv([item({ id: 'a' })]);
    const [header, row] = csv.trim().split('\n');
    expect(header).toContain('total_cents');
    expect(row).toContain('600000'); // 5 x 120000
  });
  it('quotes values containing commas or quotes', () => {
    const csv = costItemsToCsv([item({ suggestedRemedy: 'Replace, then seal "fully"' })]);
    expect(csv).toContain('"Replace, then seal ""fully"""');
  });
});
