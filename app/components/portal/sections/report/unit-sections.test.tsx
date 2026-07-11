import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { UnitSections } from '~/components/portal/sections/report/UnitSections';
import type { ReportSection, UnitMatrixRow } from '~/components/portal/sections/report/types';

const sections = [
  { id: 'roof', title: 'Roof', defectCount: 0, items: [] },
  { id: 'hvac', title: 'HVAC', defectCount: 0, items: [] },
] as ReportSection[];

const exceptionUnit: UnitMatrixRow = {
  unitId: 'u1',
  label: 'Unit 101',
  isException: true,
  cells: {
    roof: { worst: 'significant', counts: { safety: 1, recommendation: 2, maintenance: 0 } },
    hvac: { worst: null, counts: { safety: 0, recommendation: 0, maintenance: 0 } },
  },
};

const normalUnit: UnitMatrixRow = {
  unitId: 'u2',
  label: 'Unit 102',
  isException: false,
  cells: {
    roof: { worst: 'good', counts: { safety: 0, recommendation: 0, maintenance: 0 } },
    hvac: { worst: 'marginal', counts: { safety: 0, recommendation: 0, maintenance: 3 } },
  },
};

describe('UnitSections', () => {
  it('renders nothing when there are no exception units', () => {
    const { container } = render(<UnitSections rows={[normalUnit]} sections={sections} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when rows are empty', () => {
    const { container } = render(<UnitSections rows={[]} sections={sections} />);
    expect(container.firstChild).toBeNull();
  });

  it('expands each exception unit with its finding sections + severity + counts', () => {
    const { getByText, queryByText } = render(
      <UnitSections rows={[exceptionUnit, normalUnit]} sections={sections} />,
    );
    // Exception unit label + its finding section (roof) with severity + counts.
    expect(getByText('Unit 101')).toBeTruthy();
    expect(getByText('Roof')).toBeTruthy();
    expect(getByText('Significant')).toBeTruthy();
    expect(getByText('Safety: 1')).toBeTruthy();
    expect(getByText('Recommendation: 2')).toBeTruthy();
    // The non-exception unit does NOT appear.
    expect(queryByText('Unit 102')).toBeNull();
    // A section with no findings for this unit (hvac worst=null, all counts 0) is omitted.
    expect(queryByText('HVAC')).toBeNull();
  });
});
