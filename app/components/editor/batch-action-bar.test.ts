import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { BatchActionBar } from '~/components/editor/BatchActionBar';

/**
 * BatchActionBar — verifies the consolidated batch-mode control bar renders
 * all expected controls (count, Select all, Clear, rating buttons, Exit)
 * without needing a full DOM or browser environment.
 */

function render(props: Parameters<typeof BatchActionBar>[0]): string {
  return renderToStaticMarkup(React.createElement(BatchActionBar, props));
}

const baseProps = {
  count: 3,
  ratingLevels: [{ id: 'level-a' }, { id: 'level-b' }],
  getRatingColor: (id: string) => (id === 'level-a' ? '#e74c3c' : '#f39c12'),
  onSelectAll: vi.fn(),
  onClear: vi.fn(),
  onSetRating: vi.fn(),
  onExit: vi.fn(),
};

describe('BatchActionBar', () => {
  it('shows the selected count', () => {
    const html = render(baseProps);
    expect(html).toContain('3 selected');
  });

  it('includes a data-testid for the count', () => {
    const html = render(baseProps);
    expect(html).toContain('data-testid="batch-count"');
  });

  it('renders a Select all control', () => {
    const html = render(baseProps);
    expect(html.toLowerCase()).toContain('select all');
  });

  it('renders a Clear control', () => {
    const html = render(baseProps);
    expect(html.toLowerCase()).toContain('clear');
  });

  it('renders an Exit control', () => {
    const html = render(baseProps);
    // The exit/cancel button should be present
    expect(html.toLowerCase()).toMatch(/exit|cancel/);
  });

  it('renders one rating button per level', () => {
    const html = render(baseProps);
    // Two rating levels → two radiogroup tiles (RatingSegment renders
    // role="radio" per option; the former data-rating-id attribute was an
    // implementation detail of the pre-migration hand-rolled tiles).
    const matches = [...html.matchAll(/role="radio"/g)];
    expect(matches).toHaveLength(2);
  });

  it('applies the dynamic rating color via inline style', () => {
    const html = render(baseProps);
    expect(html).toContain('#e74c3c');
    expect(html).toContain('#f39c12');
  });
});
