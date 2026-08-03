// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ReportDefectCard } from './ReportDefectCard';
import type { ReportItem } from './types';

// IA-57 — trade/timeframe are captured per-defect in the editor but were only
// Mustache-interpolated into the comment; they had no independent render point,
// so a template author who left out the placeholder dropped them silently. The
// server now resolves them onto the payload (effectiveTrade/effectiveTimeframe);
// the card must surface them.

function itemWithDefect(defectOverrides: Record<string, unknown>): ReportItem {
  return {
    id: 'item1',
    label: 'Roof',
    rating: null,
    ratingColor: '#000',
    ratingLabel: null,
    severityBucket: 'defect',
    notes: null,
    photos: [],
    resolvedTabs: {
      defects: [
        {
          id: 'd1',
          title: 'Damaged shingles',
          included: true,
          effectiveComment: 'Several shingles are cracked.',
          ...defectOverrides,
        },
      ],
    },
  } as ReportItem;
}

const noMedia = () => false;
const renderTile = () => null;

describe('ReportDefectCard — trade/timeframe (IA-57)', () => {
  it('renders the recommended trade and timeframe when present', () => {
    const { getByText } = render(
      <ReportDefectCard
        item={itemWithDefect({ effectiveTrade: 'licensed plumber', effectiveTimeframe: '1 to 3 years' })}
        mediaVisible={noMedia}
        renderMediaTile={renderTile}
      />,
    );
    expect(getByText(/licensed plumber/)).toBeTruthy();
    expect(getByText(/1 to 3 years/)).toBeTruthy();
  });

  it('renders trade alone when timeframe is absent', () => {
    const { getByText, queryByText } = render(
      <ReportDefectCard
        item={itemWithDefect({ effectiveTrade: 'licensed electrician' })}
        mediaVisible={noMedia}
        renderMediaTile={renderTile}
      />,
    );
    expect(getByText(/licensed electrician/)).toBeTruthy();
    expect(queryByText(/1 to 3 years/)).toBeNull();
  });

  it('omits the trade/timeframe row entirely when both are absent', () => {
    const { container } = render(
      <ReportDefectCard
        item={itemWithDefect({})}
        mediaVisible={noMedia}
        renderMediaTile={renderTile}
      />,
    );
    // Only the comment paragraph should follow the header — no meta row.
    expect(container.querySelector('[data-defect-meta]')).toBeNull();
  });
});
