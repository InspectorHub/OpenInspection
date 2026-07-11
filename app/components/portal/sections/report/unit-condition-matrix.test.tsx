import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { UnitConditionMatrix } from '~/components/portal/sections/report/UnitConditionMatrix';
import type { ReportSection, UnitMatrixRow } from '~/components/portal/sections/report/types';

const sections = [
  { id: 'roof', title: 'Roof', defectCount: 0, items: [] },
  { id: 'hvac', title: 'HVAC', defectCount: 0, items: [] },
] as ReportSection[];

const rows: UnitMatrixRow[] = [
  {
    unitId: 'u1',
    label: 'Unit 101',
    isException: true,
    cells: {
      roof: { worst: 'significant', counts: { safety: 1, recommendation: 2, maintenance: 0 } },
      hvac: { worst: null, counts: { safety: 0, recommendation: 0, maintenance: 0 } },
    },
  },
  {
    unitId: 'u2',
    label: 'Unit 102',
    isException: false,
    cells: {
      roof: { worst: 'good', counts: { safety: 0, recommendation: 0, maintenance: 0 } },
      hvac: { worst: 'marginal', counts: { safety: 0, recommendation: 0, maintenance: 3 } },
    },
  },
];

describe('UnitConditionMatrix', () => {
  it('renders nothing when rows are empty', () => {
    const { container } = render(<UnitConditionMatrix rows={[]} sections={sections} defectCounts={{}} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders unit labels, section titles, severity labels, and defect counts', () => {
    const { getByText, getAllByText } = render(
      <UnitConditionMatrix rows={rows} sections={sections} defectCounts={{ u1: 3, u2: 0 }} />,
    );
    // Unit labels
    expect(getByText('Unit 101')).toBeTruthy();
    expect(getByText('Unit 102')).toBeTruthy();
    // Section column headers
    expect(getByText('Roof')).toBeTruthy();
    expect(getByText('HVAC')).toBeTruthy();
    // Severity pill labels
    expect(getByText('Significant')).toBeTruthy();
    expect(getByText('Good')).toBeTruthy();
    expect(getByText('Marginal')).toBeTruthy();
    // Category counts (only non-zero shown): u1 roof has S:1 R:2
    expect(getByText('S:1')).toBeTruthy();
    expect(getByText('R:2')).toBeTruthy();
    // Defect count column value for the exception unit
    expect(getAllByText('3').length).toBeGreaterThan(0);
  });

  it('flags exception rows with an Exception badge', () => {
    const { getByText, queryAllByText } = render(
      <UnitConditionMatrix rows={rows} sections={sections} defectCounts={{ u1: 3, u2: 0 }} />,
    );
    expect(getByText('Exception')).toBeTruthy();
    // Only the one exception unit is flagged.
    expect(queryAllByText('Exception').length).toBe(1);
  });

  it('renders a neutral placeholder for a null-worst cell, not a severity pill', () => {
    const { getByLabelText } = render(
      <UnitConditionMatrix rows={rows} sections={sections} defectCounts={{ u1: 3, u2: 0 }} />,
    );
    // u1's hvac cell has worst=null → em-dash placeholder with aria-label.
    expect(getByLabelText('No findings')).toBeTruthy();
  });
});
