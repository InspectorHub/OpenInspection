import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SystemsSummaryTable } from '~/components/portal/sections/report/SystemsSummaryTable';

describe('SystemsSummaryTable', () => {
  it('renders nothing when rows are empty', () => {
    const { container } = render(<SystemsSummaryTable rows={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a row per system with severity + category counts', () => {
    const { getByText } = render(<SystemsSummaryTable rows={[
      { systemId: 'mep', systemTitle: 'Mechanical, Electrical & Plumbing', worstSeverity: 'significant', counts: { safety: 2, recommendation: 1, maintenance: 0 } },
    ]} />);
    expect(getByText('Mechanical, Electrical & Plumbing')).toBeTruthy();
    expect(getByText(/Significant/i)).toBeTruthy();
  });
});
