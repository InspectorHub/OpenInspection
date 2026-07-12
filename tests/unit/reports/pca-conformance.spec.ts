// tests/unit/reports/pca-conformance.spec.ts
import { describe, it, expect } from 'vitest';
import { computeConformance, deriveConformanceInput } from '../../../server/lib/pca-conformance';

describe('computeConformance', () => {
  it('conforms only when all three gates pass', () => {
    expect(computeConformance({
      reviewerSignoffPresent: true, deviationsDisclosed: true, mandatoryExhibitsPresentOrDisclosed: true,
    })).toEqual({ standard: 'E2018-24', conforms: true });
  });

  it('non-conformant when the reviewer sign-off is missing', () => {
    expect(computeConformance({
      reviewerSignoffPresent: false, deviationsDisclosed: true, mandatoryExhibitsPresentOrDisclosed: true,
    }).conforms).toBe(false);
  });

  it('non-conformant when deviations are not disclosed', () => {
    expect(computeConformance({
      reviewerSignoffPresent: true, deviationsDisclosed: false, mandatoryExhibitsPresentOrDisclosed: true,
    }).conforms).toBe(false);
  });

  it('non-conformant when a mandatory exhibit is neither present nor disclosed', () => {
    expect(computeConformance({
      reviewerSignoffPresent: true, deviationsDisclosed: true, mandatoryExhibitsPresentOrDisclosed: false,
    }).conforms).toBe(false);
  });
});

describe('deriveConformanceInput', () => {
  it('reviewer gate reads the pcr_reviewer signoff row', () => {
    const input = deriveConformanceInput({
      reportSignoffs: [{ role: 'field_observer' }, { role: 'pcr_reviewer' }],
      deviations: [], psqStatus: 'received', psqDisclosedInDeviations: false,
    });
    expect(input.reviewerSignoffPresent).toBe(true);
  });

  it('a declined PSQ disclosed in deviations still satisfies the exhibit gate', () => {
    const input = deriveConformanceInput({
      reportSignoffs: [{ role: 'pcr_reviewer' }],
      deviations: [{ area: 'PSQ' }], psqStatus: 'declined', psqDisclosedInDeviations: true,
    });
    expect(input.mandatoryExhibitsPresentOrDisclosed).toBe(true);
    expect(input.deviationsDisclosed).toBe(true);
  });

  it('a declined PSQ NOT disclosed fails the exhibit gate', () => {
    const input = deriveConformanceInput({
      reportSignoffs: [{ role: 'pcr_reviewer' }],
      deviations: [], psqStatus: 'declined', psqDisclosedInDeviations: false,
    });
    expect(input.mandatoryExhibitsPresentOrDisclosed).toBe(false);
  });

  it('end-to-end: declined+disclosed PSQ with a reviewer signoff is conformant', () => {
    const input = deriveConformanceInput({
      reportSignoffs: [{ role: 'pcr_reviewer' }],
      deviations: [{ area: 'PSQ' }], psqStatus: 'declined', psqDisclosedInDeviations: true,
    });
    expect(computeConformance(input).conforms).toBe(true);
  });
});
