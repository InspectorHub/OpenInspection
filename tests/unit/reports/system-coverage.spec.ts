// tests/unit/reports/system-coverage.spec.ts
import { describe, it, expect } from 'vitest';
import { SYSTEM_COVERAGE, resolveSystemCoverage } from '../../../server/lib/system-coverage';

describe('system coverage standard attribution', () => {
  const byId = (id: string) => SYSTEM_COVERAGE.find((c) => c.id === id)!;

  it('attributes Vertical Transportation to ASTM E2018 §7 (NOT ComSOP)', () => {
    expect(byId('vertical-transportation').attribution).toEqual({ standard: 'ASTM E2018', section: '§7' });
  });
  it('attributes Site/Flatwork to ASTM E2018 §5', () => {
    expect(byId('site-flatwork').attribution).toEqual({ standard: 'ASTM E2018', section: '§5' });
  });
  it('attributes Loading Docks to ASTM E2018 (interior/structural, not ComSOP)', () => {
    expect(byId('loading-docks').attribution.standard).toBe('ASTM E2018');
  });
  it('attributes Wood Decks & Balconies to genuine ComSOP §6.5.3', () => {
    expect(byId('wood-decks-balconies').attribution).toEqual({ standard: 'CCPIA ComSOP', section: '§6.5.3' });
  });
  it('attributes Cooking Areas to genuine ComSOP §6.5.13', () => {
    expect(byId('cooking-areas').attribution).toEqual({ standard: 'CCPIA ComSOP', section: '§6.5.13' });
  });
});

describe('resolveSystemCoverage', () => {
  it('returns Vertical Transportation for office/retail/hospitality/institutional', () => {
    for (const s of ['office', 'retail', 'hospitality', 'institutional']) {
      expect(resolveSystemCoverage(s, {}).some((c) => c.id === 'vertical-transportation')).toBe(true);
    }
  });
  it('mounts Cooking Areas only when the kitchen flag is on', () => {
    expect(resolveSystemCoverage('hospitality', {}).some((c) => c.id === 'cooking-areas')).toBe(false);
    expect(resolveSystemCoverage('hospitality', { hasCommercialKitchen: true }).some((c) => c.id === 'cooking-areas')).toBe(true);
  });
  it('mounts Loading Docks for industrial', () => {
    expect(resolveSystemCoverage('industrial', { isIndustrial: true }).some((c) => c.id === 'loading-docks')).toBe(true);
  });
  it('returns [] for a null subtype', () => {
    expect(resolveSystemCoverage(null, {})).toEqual([]);
  });
});
