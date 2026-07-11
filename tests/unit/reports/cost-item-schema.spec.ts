// tests/unit/reports/cost-item-schema.spec.ts
import { describe, it, expect } from 'vitest';
import { CreateCostItemSchema } from '../../../server/lib/validations/cost-item.schema';

describe('CreateCostItemSchema', () => {
  it('accepts a valid unit-method item', () => {
    const r = CreateCostItemSchema.safeParse({
      system: 'roof', component: 'membrane', action: 'replace', costMethod: 'unit',
      quantity: 5, uom: 'sf', unitCostCents: 120000, bucket: 'immediate',
    });
    expect(r.success).toBe(true);
  });
  it('rejects an unknown action', () => {
    const r = CreateCostItemSchema.safeParse({
      system: 'roof', component: 'membrane', action: 'maintain', costMethod: 'unit', bucket: 'immediate',
    });
    expect(r.success).toBe(false);
  });
  it('rejects negative cents', () => {
    const r = CreateCostItemSchema.safeParse({
      system: 'roof', component: 'membrane', action: 'replace', costMethod: 'lump_sum',
      lumpSumCents: -1, bucket: 'immediate',
    });
    expect(r.success).toBe(false);
  });
});
