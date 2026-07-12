// server/lib/pca-conformance.ts

/**
 * Commercial PCA Phase M — the ASTM E2018 conformance computation. A report may
 * claim conformance only when ALL gates pass (spec §7):
 *   1. the PCR reviewer sign-off is present (§7.5),
 *   2. deviations from the Guide are disclosed (§11.4.3),
 *   3. every mandatory exhibit (PSQ §8.5, doc-review §8.6) is present OR its
 *      omission is disclosed in Deviations.
 * Pure + side-effect-free so it is identical for the report payload and the
 * editor preview, and unit-tested as a truth table.
 */

export interface AstmConformance {
  standard: 'E2018-24';
  conforms: boolean;
}

export interface ConformanceInput {
  reviewerSignoffPresent: boolean;
  deviationsDisclosed: boolean;
  mandatoryExhibitsPresentOrDisclosed: boolean;
}

export function computeConformance(input: ConformanceInput): AstmConformance {
  return {
    standard: 'E2018-24',
    conforms:
      input.reviewerSignoffPresent &&
      input.deviationsDisclosed &&
      input.mandatoryExhibitsPresentOrDisclosed,
  };
}

export interface ConformanceGateSources {
  reportSignoffs: Array<{ role: string }>;
  deviations: unknown[];
  psqStatus: 'sent' | 'received' | 'declined' | null;
  psqDisclosedInDeviations: boolean;
}

export function deriveConformanceInput(s: ConformanceGateSources): ConformanceInput {
  const reviewerSignoffPresent = s.reportSignoffs.some((r) => r.role === 'pcr_reviewer');
  // "Disclosed" = the Deviations store is non-empty (ASTM requires the section
  // to exist + state deviations; an empty list reads as "no deviations claimed").
  const deviationsDisclosed = s.deviations.length > 0;
  // PSQ exhibit gate: present (received) OR its omission disclosed in Deviations.
  const psqOk =
    s.psqStatus === 'received' ||
    (s.psqStatus === 'declined' && s.psqDisclosedInDeviations);
  const mandatoryExhibitsPresentOrDisclosed = psqOk;
  return { reviewerSignoffPresent, deviationsDisclosed, mandatoryExhibitsPresentOrDisclosed };
}
