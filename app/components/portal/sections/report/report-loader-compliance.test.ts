import { describe, it, expect } from 'vitest';
import type { ReportLoaderResult } from './types';

describe('ReportLoaderResult compliance', () => {
  it('carries astmConformance, reportSignoffs, psq, documentReview, relianceText', () => {
    const sample: Pick<ReportLoaderResult, 'astmConformance' | 'reportSignoffs' | 'psq' | 'documentReview' | 'relianceText'> = {
      astmConformance: { standard: 'E2018-24', conforms: true },
      reportSignoffs: [{ role: 'pcr_reviewer', name: 'Jane', license: 'PE-1', qualificationsRef: null, signedAt: 1, dualRole: false }],
      psq: { status: 'received', responses: { a: 1 } },
      documentReview: [{ documentKey: 'prior_pcrs', label: 'Prior PCRs', requested: true, received: false, reviewed: false, na: false, notes: null }],
      relianceText: { userReliance: 'x', pointInTime: 'y', siteSpecific: 'z' },
    };
    expect(sample.astmConformance?.conforms).toBe(true);
  });
});
