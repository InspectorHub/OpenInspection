// tests/unit/reports/pca-document-catalog.spec.ts
import { describe, it, expect } from 'vitest';
import { DOCUMENT_REVIEW_CATALOG } from '../../../server/lib/pca-document-catalog';
import { RELIANCE_TEMPLATES } from '../../../server/lib/pca-reliance-text';

describe('DOCUMENT_REVIEW_CATALOG', () => {
  it('has unique stable keys and monotonic sort order', () => {
    const keys = DOCUMENT_REVIEW_CATALOG.map((d) => d.documentKey);
    expect(new Set(keys).size).toBe(keys.length);
    const orders = DOCUMENT_REVIEW_CATALOG.map((d) => d.sortOrder);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
  });

  it('includes the §8.6 mandatory items plus zoning + previous-reports sub-items', () => {
    const keys = DOCUMENT_REVIEW_CATALOG.map((d) => d.documentKey);
    for (const required of ['certificate_of_occupancy', 'code_fire_violations', 'prior_pcrs', 'zoning_compliance', 'previous_reports']) {
      expect(keys).toContain(required);
    }
    expect(DOCUMENT_REVIEW_CATALOG.length).toBeGreaterThanOrEqual(15);
  });
});

describe('RELIANCE_TEMPLATES', () => {
  it('provides non-empty reliance / point-in-time / site-specific defaults', () => {
    expect(RELIANCE_TEMPLATES.userReliance.length).toBeGreaterThan(0);
    expect(RELIANCE_TEMPLATES.pointInTime.length).toBeGreaterThan(0);
    expect(RELIANCE_TEMPLATES.siteSpecific.length).toBeGreaterThan(0);
  });
});
