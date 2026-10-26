import { describe, it, expect } from 'vitest';
import { PcaNarrativePatchSchema } from '../../../server/lib/validations/pca-narrative.schema';
import { updatePcaNarrativeRoute } from '../../../server/api/inspections/results';

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

  it('rejects an unknown key and names it (a dropped key would answer 200 and store nothing)', () => {
    const r = PcaNarrativePatchSchema.safeParse({ purpose: 'p', methodology: 'old' });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(JSON.stringify(r.error.issues)).toContain('methodology');
    }
  });

  it('preserves the three reliance text keys (ASTM §4.2.1–4.2.4)', () => {
    const r = PcaNarrativePatchSchema.safeParse({
      userReliance: 'reliance text',
      pointInTime: 'point-in-time text',
      siteSpecific: 'site-specific text',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.userReliance).toBe('reliance text');
      expect(r.data.pointInTime).toBe('point-in-time text');
      expect(r.data.siteSpecific).toBe('site-specific text');
    }
  });
});

describe('the PCA narrative route body', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bodySchema = (updatePcaNarrativeRoute as any).request.body.content['application/json'].schema;

  it('refuses an unknown key and accepts a declared one', () => {
    expect(bodySchema.safeParse({ methodology: 'x' }).success).toBe(false);
    expect(bodySchema.safeParse({ purpose: 'x' }).success).toBe(true);
  });
});
