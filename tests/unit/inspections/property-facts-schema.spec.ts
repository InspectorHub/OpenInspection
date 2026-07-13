import { describe, it, expect } from 'vitest';
import { PropertyFactsWriteSchema } from '../../../server/lib/validations/inspection/read';

describe('PropertyFactsWriteSchema', () => {
  it('accepts dedicated keys plus a metadata envelope', () => {
    const r = PropertyFactsWriteSchema.safeParse({
      yearBuilt: 1998,
      metadata: { nra: 42000, sprinklered: 'Full', floorCount: 4, lastRenovation: null },
    });
    expect(r.success).toBe(true);
  });

  it('accepts a payload with no metadata (backward compatible with the strip)', () => {
    const r = PropertyFactsWriteSchema.safeParse({ yearBuilt: 2001, county: 'Travis County' });
    expect(r.success).toBe(true);
  });

  it('rejects a non-primitive metadata value', () => {
    const r = PropertyFactsWriteSchema.safeParse({ metadata: { nested: { a: 1 } } });
    expect(r.success).toBe(false);
  });
});
