import { describe, it, expect } from 'vitest';
import type { ReportLoaderResult } from '~/components/portal/sections/report/types';

describe('ReportLoaderResult pcaReport', () => {
  it('carries the PCA skeleton block', () => {
    const sample: Pick<ReportLoaderResult, 'pcaReport'> = {
      pcaReport: {
        sectionRegistry: [{ id: 'cover', level: 0, title: 'Cover', tiers: ['light', 'full'] }],
        narrative: { transmittalLetter: '', summaryGeneralDescription: '', summaryPhysicalCondition: '', summaryRecommendations: '', purpose: 'p', scopeOfWork: '', limitationsExceptions: '', reconnaissance: '', additionalConsiderations: '' },
        systemsSummary: [{ systemId: 'site', systemTitle: 'Site', worstSeverity: 'good', counts: { safety: 0, recommendation: 0, maintenance: 0 } }],
        deviations: [],
      },
    };
    expect(sample.pcaReport?.sectionRegistry[0].id).toBe('cover');
    expect(sample.pcaReport?.narrative.purpose).toBe('p');
  });
});
