import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { SectionRail } from '~/components/editor/SectionRail';

/**
 * Section Rail — "Inspection Details" overview entry (D3)
 *
 * Verifies that the rail renders a report-scoped overview entry above the
 * section list and that it carries the correct active / inactive state.
 */

const SECTIONS = [
  { id: 'sec-1', title: 'Roof', items: [{ id: 'item-1' }, { id: 'item-2' }] },
  { id: 'sec-2', title: 'Electrical', items: [{ id: 'item-3' }] },
];

function renderRail(overviewActive: boolean): string {
  return renderToStaticMarkup(
    createElement(SectionRail, {
      sections: SECTIONS,
      activeSection: 'sec-1',
      onSelect: () => {},
      results: {},
      overviewActive,
      onSelectOverview: () => {},
    })
  );
}

describe('SectionRail — Inspection Details overview entry', () => {
  it('renders an "Inspection Details" entry', () => {
    const html = renderRail(false);
    expect(html).toContain('Inspection Details');
  });

  it('has data-testid="inspection-details-entry"', () => {
    const html = renderRail(false);
    expect(html).toContain('data-testid="inspection-details-entry"');
  });

  it('sets aria-current="true" when overviewActive is true', () => {
    const html = renderRail(true);
    expect(html).toContain('aria-current="true"');
  });

  it('does not set aria-current="true" when overviewActive is false', () => {
    const html = renderRail(false);
    expect(html).not.toContain('aria-current="true"');
  });

  it('applies active styling when overviewActive is true', () => {
    const html = renderRail(true);
    // Active sections get text-ih-primary — the overview entry should mirror this
    const detailsEntryMatch = html.match(/data-testid="inspection-details-entry"[^>]*>[\s\S]*?<\/button>/);
    expect(detailsEntryMatch).not.toBeNull();
    expect(detailsEntryMatch![0]).toContain('text-ih-primary');
  });

  it('still renders section buttons below the overview entry', () => {
    const html = renderRail(false);
    expect(html).toContain('Roof');
    expect(html).toContain('Electrical');
  });
});
