import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ConformanceStatement } from './ConformanceStatement';
import { SignoffBlock } from './SignoffBlock';
import { DocumentReviewTable } from './DocumentReviewTable';
import { PsqExhibit } from './PsqExhibit';

describe('compliance render', () => {
  it('ConformanceStatement renders nothing when conformance is null (non-full-pca)', () => {
    const { container } = render(<ConformanceStatement conformance={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('ConformanceStatement states conformance + standard', () => {
    const { getByText } = render(<ConformanceStatement conformance={{ standard: 'E2018-24', conforms: true }} />);
    expect(getByText(/E2018-24/)).toBeTruthy();
    expect(getByText(/conforms/i)).toBeTruthy();
  });

  it('ConformanceStatement states non-conformance', () => {
    const { getByText } = render(<ConformanceStatement conformance={{ standard: 'E2018-24', conforms: false }} />);
    expect(getByText(/does not conform/i)).toBeTruthy();
  });

  it('SignoffBlock renders nothing when there are no signoffs', () => {
    const { container } = render(<SignoffBlock signoffs={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('SignoffBlock renders both roles, marking a dual-role signer', () => {
    const { getByText, getAllByText } = render(<SignoffBlock signoffs={[
      { role: 'field_observer', name: 'Jane', license: 'PE-1', qualificationsRef: null, signedAt: 1, dualRole: true },
      { role: 'pcr_reviewer', name: 'Jane', license: 'PE-1', qualificationsRef: null, signedAt: 2, dualRole: true },
    ]} />);
    expect(getByText(/Field Observer/i)).toBeTruthy();
    expect(getByText(/PCR Reviewer/i)).toBeTruthy();
    expect(getAllByText(/dual/i).length).toBeGreaterThan(0);
  });

  it('SignoffBlock omits the dual-role note for single-role signoffs', () => {
    const { queryByText } = render(<SignoffBlock signoffs={[
      { role: 'field_observer', name: 'Jane', license: null, qualificationsRef: null, signedAt: 1, dualRole: false },
    ]} />);
    expect(queryByText(/dual/i)).toBeNull();
  });

  it('DocumentReviewTable renders nothing when there are no items', () => {
    const { container } = render(<DocumentReviewTable items={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('DocumentReviewTable states a not-provided item as a limitation, never drops it', () => {
    const { getByText } = render(<DocumentReviewTable items={[
      { documentKey: 'rent_roll', label: 'Rent roll', requested: true, received: false, reviewed: false, na: false, notes: null },
    ]} />);
    expect(getByText('Rent roll')).toBeTruthy();
    expect(getByText(/not provided|not received/i)).toBeTruthy();
  });

  it('DocumentReviewTable renders every item, including received and N/A rows without a limitation marker', () => {
    const { getByText, queryByText } = render(<DocumentReviewTable items={[
      { documentKey: 'rent_roll', label: 'Rent roll', requested: true, received: true, reviewed: true, na: false, notes: 'ok' },
      { documentKey: 'survey', label: 'Survey', requested: true, received: false, reviewed: false, na: true, notes: null },
    ]} />);
    expect(getByText('Rent roll')).toBeTruthy();
    expect(getByText('Survey')).toBeTruthy();
    expect(queryByText(/not provided \(limitation\)/i)).toBeNull();
  });

  it('PsqExhibit renders nothing when psq is null', () => {
    const { container } = render(<PsqExhibit psq={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('PsqExhibit renders responses as a definition list', () => {
    const { getByText } = render(<PsqExhibit psq={{ status: 'received', responses: { 'Known asbestos?': 'No' } }} />);
    expect(getByText('Known asbestos?')).toBeTruthy();
    expect(getByText('No')).toBeTruthy();
  });

  it('PsqExhibit shows a declined note pointing to Deviations', () => {
    const { getByText } = render(<PsqExhibit psq={{ status: 'declined', responses: null }} />);
    expect(getByText(/PSQ declined/i)).toBeTruthy();
    expect(getByText(/Deviations/i)).toBeTruthy();
  });
});
