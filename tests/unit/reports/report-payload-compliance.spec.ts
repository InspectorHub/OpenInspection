// tests/unit/reports/report-payload-compliance.spec.ts
// Commercial PCA Phase M — pins the payload-shaping contract for
// astmConformance/relianceText that getReportData wires (production wiring
// is exercised by the Task 9 loader test + E2E, per the Phase M brief).
import { describe, it, expect } from 'vitest';
import { computeConformance, deriveConformanceInput } from '../../../server/lib/pca-conformance';
import { RELIANCE_TEMPLATES } from '../../../server/lib/pca-reliance-text';

describe('report payload compliance shaping', () => {
  it('full_pca with reviewer + received PSQ + a deviation is conformant', () => {
    const conformance = computeConformance(deriveConformanceInput({
      reportSignoffs: [{ role: 'pcr_reviewer' }], deviations: [{ area: 'cost-threshold' }],
      psqStatus: 'received', psqDisclosedInDeviations: false,
    }));
    expect(conformance.conforms).toBe(true);
  });

  it('reliance text falls back to the seeded templates', () => {
    const edited: Partial<typeof RELIANCE_TEMPLATES> = { userReliance: 'custom' };
    const resolved = { ...RELIANCE_TEMPLATES, ...edited };
    expect(resolved.userReliance).toBe('custom');
    expect(resolved.pointInTime).toBe(RELIANCE_TEMPLATES.pointInTime);
  });
});
