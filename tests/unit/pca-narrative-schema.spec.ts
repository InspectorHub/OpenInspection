import { describe, it, expect } from 'vitest';
import { PcaNarrativePatchSchema } from '../../server/lib/validations/pca-narrative.schema';

describe('PcaNarrativePatchSchema', () => {
  it('accepts a partial body (any subset of narrative keys)', () => {
    const r = PcaNarrativePatchSchema.safeParse({ purpose: 'new purpose' });
    expect(r.success).toBe(true);
  });

  it('accepts an empty body (no-op patch)', () => {
    expect(PcaNarrativePatchSchema.safeParse({}).success).toBe(true);
  });

  it('rejects a non-string value', () => {
    const r = PcaNarrativePatchSchema.safeParse({ purpose: 42 });
    expect(r.success).toBe(false);
  });

  it('strips unknown keys (old-shape tolerance)', () => {
    const r = PcaNarrativePatchSchema.safeParse({ purpose: 'p', methodology: 'old' });
    expect(r.success).toBe(true);
    if (r.success) expect('methodology' in r.data).toBe(false);
  });
});
