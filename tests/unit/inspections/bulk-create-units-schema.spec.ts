import { describe, it, expect } from 'vitest';
import { BulkCreateUnitsSchema } from '../../../server/lib/validations/unit.schema';

describe('BulkCreateUnitsSchema', () => {
  it('accepts a floors_stacks payload', () => {
    const r = BulkCreateUnitsSchema.safeParse({ mode: 'floors_stacks', floors: [1, 2], stacks: 4 });
    expect(r.success).toBe(true);
  });
  it('accepts a csv payload', () => {
    const r = BulkCreateUnitsSchema.safeParse({ mode: 'csv', csv: '101,1\n102,1' });
    expect(r.success).toBe(true);
  });
  it('rejects an unknown mode', () => {
    const r = BulkCreateUnitsSchema.safeParse({ mode: 'grid', rows: 4 });
    expect(r.success).toBe(false);
  });
});
