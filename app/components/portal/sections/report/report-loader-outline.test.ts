import { describe, it, expect } from 'vitest';
import type { ReportLoaderResult, ReportOutlineEntry } from './types';

describe('ReportLoaderResult outline', () => {
  it('carries an outline array of ReportOutlineEntry', () => {
    const sample: Pick<ReportLoaderResult, 'outline'> = {
      outline: [
        { id: 'summary', level: 1, title: '1. Summary' },
        { id: 'summary.general-description', level: 2, title: 'General Description', page: null },
      ],
    };
    expect(sample.outline[0].id).toBe('summary');
    expect(sample.outline[1].level).toBe(2);
  });

  it('empty outline for residential (no reportTier)', () => {
    const sample: Pick<ReportLoaderResult, 'outline'> = { outline: [] };
    expect(sample.outline).toEqual([]);
  });

  it('ReportOutlineEntry.page is optional/nullable (PDF pass fills it)', () => {
    const entry: ReportOutlineEntry = { id: 'site', level: 1, title: 'Site' };
    expect(entry.page).toBeUndefined();
  });
});
