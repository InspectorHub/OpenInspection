import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { CostTables } from './CostTables';
import type { CostTables as CT } from './types';

const base: CT = {
  table1: {
    immediate: [{ item: { id: 'a', system: 'roof', component: 'membrane', location: '', action: 'replace', costMethod: 'lump_sum', quantity: null, uom: null, unitCostCents: null, lumpSumCents: 500000, eul: null, effAge: null, rul: null, suggestedRemedy: 'Replace', bucket: 'immediate', sectionRef: null, photoRef: null, sortOrder: 0 }, total: 500000 }],
    shortTerm: [], immediateTotalCents: 500000, shortTermTotalCents: 0,
  },
  reserveSchedule: null,
  rollup: { immediateCents: 500000, shortTermCents: 0, reserveCents: 0 },
  droppedCount: 0,
};

describe('CostTables', () => {
  it('renders nothing when show is false', () => {
    const { container } = render(<CostTables data={base} show={false} />);
    expect(container.firstChild).toBeNull();
  });
  it('renders TABLE 1 with a dollar-formatted total, no reserve grid when null', () => {
    const { getByText, getAllByText, queryByText } = render(<CostTables data={base} show={true} />);
    expect(getByText(/Opinion of Cost/i)).toBeTruthy();
    // 500000 cents -> $5,000.00. Both the row's Immediate cell and the Totals
    // footer render this value for a single-item fixture, so assert at least
    // one match rather than a unique one.
    expect(getAllByText(/\$5,000/).length).toBeGreaterThan(0);
    expect(queryByText(/Reserve Schedule/i)).toBeNull();
  });
  it('renders the reserve grid when reserveSchedule is present', () => {
    const withReserve: CT = { ...base, reserveSchedule: {
      startYear: 2026, termYears: 2, years: [2026, 2027],
      rows: [{ item: base.table1.immediate[0].item, placementYear: 2026, replacementCents: 500000 }],
      uninflatedByYear: [500000, 0], inflatedByYear: [500000, 0], cumulativeInflatedByYear: [500000, 500000],
      totalUninflatedCents: 500000, totalInflatedCents: 500000,
      perSfUninflatedAllYears: null, perSfInflatedAllYears: null, perSfInflatedPerYear: null,
    } };
    const { getByText } = render(<CostTables data={withReserve} show={true} />);
    expect(getByText(/Reserve Schedule/i)).toBeTruthy();
  });
});
