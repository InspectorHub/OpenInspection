import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { PcaSkeleton } from '~/components/portal/sections/report/PcaSkeleton';
import type { PcaReportData } from '~/components/portal/sections/report/types';

const data: PcaReportData = {
  sectionRegistry: [
    { id: 'summary.deviations', level: 2, title: 'Deviations from the Guide', tiers: ['light', 'full'] },
    { id: 'introduction.limitations-exceptions', level: 2, title: 'Limitations & Exceptions', tiers: ['light', 'full'] },
  ],
  narrative: {
    transmittalLetter: 'TL copy', summaryGeneralDescription: 'GD', summaryPhysicalCondition: 'PC',
    summaryRecommendations: 'REC', purpose: 'PURP', scopeOfWork: 'SCOPE incl methodology',
    limitationsExceptions: 'LIMITS', reconnaissance: 'RECON', additionalConsiderations: 'ADDL',
  },
  systemsSummary: [{ systemId: 'site', systemTitle: 'Site', worstSeverity: 'good', counts: { safety: 0, recommendation: 0, maintenance: 0 } }],
  deviations: [{ id: 'd1', area: 'Cost threshold', baselineRequirement: '$3k', deviation: 'raised to $5k', reason: 'client' }],
};

describe('PcaSkeleton', () => {
  it('renders nothing when data is null', () => {
    const { container } = render(<PcaSkeleton data={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the transmittal, scope (with methodology folded in), limitations up front, and the deviation entry', () => {
    const { getByText, queryByText } = render(<PcaSkeleton data={data} />);
    expect(getByText('TL copy')).toBeTruthy();
    expect(getByText(/SCOPE incl methodology/)).toBeTruthy();
    expect(getByText('LIMITS')).toBeTruthy();
    expect(getByText(/raised to \$5k/)).toBeTruthy();
    // no standalone methodology heading
    expect(queryByText(/^Methodology$/)).toBeNull();
  });
});
