import { describe, it, expect } from 'vitest';
import type { ReportLoaderResult } from './types';

describe('ReportLoaderResult photo appendix', () => {
  it('carries photoMode + photoAppendix', () => {
    const sample: Pick<ReportLoaderResult, 'photoMode' | 'photoAppendix'> = {
      photoMode: 'appendix',
      photoAppendix: [{ photoNo: 1, key: 'a', url: '/p/a', caption: null, sectionId: 's1', sectionTitle: 'Roof', itemId: 'i1', itemLabel: 'A' }],
    };
    expect(sample.photoAppendix[0].photoNo).toBe(1);
    expect(sample.photoMode).toBe('appendix');
  });
});
