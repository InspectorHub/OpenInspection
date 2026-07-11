// tests/unit/reports/report-tier.spec.ts
import { describe, it, expect } from 'vitest';
import { resolveReportTier, REPORT_TIERS } from '../../../server/lib/report-tier';

describe('resolveReportTier', () => {
  it('returns null for non-commercial property types (tier N/A)', () => {
    expect(resolveReportTier({ propertyType: 'single_family' })).toBeNull();
    expect(resolveReportTier({ propertyType: 'multi_unit' })).toBeNull();
    expect(resolveReportTier({ propertyType: null })).toBeNull();
  });

  it('defaults a commercial inspection to light_commercial (auto-light, user elevates)', () => {
    expect(resolveReportTier({ propertyType: 'commercial' })).toBe('light_commercial');
    expect(resolveReportTier({ propertyType: 'commercial', storedTier: null })).toBe('light_commercial');
  });

  it('lets an explicitly stored tier win (both directions)', () => {
    expect(resolveReportTier({ propertyType: 'commercial', storedTier: 'full_pca' })).toBe('full_pca');
    expect(resolveReportTier({ propertyType: 'commercial', storedTier: 'light_commercial' })).toBe('light_commercial');
  });

  it('ignores a stored tier on a non-commercial inspection (stays null)', () => {
    expect(resolveReportTier({ propertyType: 'single_family', storedTier: 'full_pca' })).toBeNull();
  });

  it('exposes the canonical tier list', () => {
    expect(REPORT_TIERS).toEqual(['light_commercial', 'full_pca']);
  });
});
