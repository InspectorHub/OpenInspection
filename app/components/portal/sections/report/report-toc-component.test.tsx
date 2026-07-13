import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ReportToc } from '~/components/portal/sections/report/ReportToc';
import type { ReportOutlineEntry } from '~/components/portal/sections/report/types';

const entries: ReportOutlineEntry[] = [
  { id: 'summary', level: 1, title: '1. Summary' },
  { id: 'summary.general-description', level: 2, title: '1.1 General Description' },
  { id: 'site', level: 1, title: '5. Site' },
];

describe('ReportToc', () => {
  it('renders nothing when entries are empty', () => {
    const { container } = render(<ReportToc entries={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders an anchor per entry pointing at #id (no dangling)', () => {
    const { getByText } = render(<ReportToc entries={entries} />);
    expect(getByText('1. Summary').closest('a')?.getAttribute('href')).toBe('#summary');
    expect(getByText('1.1 General Description').closest('a')?.getAttribute('href')).toBe(
      '#summary.general-description',
    );
    expect(getByText('5. Site').closest('a')?.getAttribute('href')).toBe('#site');
  });

  it('indents level-2 entries via data-level', () => {
    const { getByText } = render(<ReportToc entries={entries} />);
    const li = getByText('1.1 General Description').closest('li');
    expect(li?.getAttribute('data-level')).toBe('2');
    const topLi = getByText('1. Summary').closest('li');
    expect(topLi?.getAttribute('data-level')).toBe('1');
  });

  it('always reserves the page-number slot, empty when tocPages is absent (web + PDF pass 1)', () => {
    const { container } = render(<ReportToc entries={entries} />);
    const refs = container.querySelectorAll('.toc-pageref');
    expect(refs.length).toBe(entries.length);
    for (const el of refs) expect(el.textContent).toBe('');
  });

  it('fills each reserved slot from tocPages, keyed by entry id (Task 19a pass 2)', () => {
    const { container } = render(
      <ReportToc entries={entries} tocPages={{ summary: 3, site: 11 }} />,
    );
    const refs = Array.from(container.querySelectorAll('.toc-pageref'));
    // 'summary' -> 3, 'summary.general-description' has no map entry -> empty, 'site' -> 11.
    expect(refs.map((el) => el.textContent)).toEqual(['3', '', '11']);
  });
});
