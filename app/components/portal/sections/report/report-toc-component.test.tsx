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

  it('omits the page-number column on the web (showPageNumbers=false default)', () => {
    const { container } = render(<ReportToc entries={entries} />);
    expect(container.querySelector('.toc-pageref')).toBeNull();
  });

  it('renders the page-number column only when showPageNumbers is true', () => {
    const { container } = render(<ReportToc entries={entries} showPageNumbers />);
    expect(container.querySelectorAll('.toc-pageref').length).toBe(entries.length);
  });
});
