// tests/unit/reports/report-tier-payload.spec.ts
// Pins the payload-shaping contract: getReportData resolves report_tier from the
// inspection row via resolveReportTier (commercial -> light by default, stored wins).
import { describe, it, expect } from 'vitest';
import { resolveReportTier } from '../../../server/lib/report-tier';

describe('report payload tier shaping', () => {
  it('resolves light_commercial for a commercial inspection with no stored tier', () => {
    const inspection = { propertyType: 'commercial', reportTier: null } as const;
    expect(resolveReportTier({ propertyType: inspection.propertyType, storedTier: inspection.reportTier })).toBe('light_commercial');
  });

  it('resolves full_pca when stored', () => {
    const inspection = { propertyType: 'commercial', reportTier: 'full_pca' } as const;
    expect(resolveReportTier({ propertyType: inspection.propertyType, storedTier: inspection.reportTier })).toBe('full_pca');
  });

  it('resolves null for residential regardless of stored tier', () => {
    const inspection = { propertyType: 'single_family', reportTier: 'full_pca' } as const;
    expect(resolveReportTier({ propertyType: inspection.propertyType, storedTier: inspection.reportTier })).toBeNull();
  });
});
