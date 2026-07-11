// tests/unit/reports/inspection-report-photo-appendix.spec.ts
// Pins the payload-shaping contract using the pure helpers against a
// sections-shaped fixture (mirrors what getReportData passes post-assembly).
import { describe, it, expect } from 'vitest';
import { assignPhotoNumbers, derivePhotoMode } from '../../../server/lib/report-photos';

describe('report payload photo appendix shaping', () => {
  it('produces a numbered appendix + appendix mode for a full_pca report', () => {
    const sections = [{
      id: 's1', title: 'Roof',
      items: [{ id: 'i1', label: 'Covering', photos: [{ key: 'a', url: '/p/a', caption: 'tile' }], resolvedTabs: { defects: [] } }],
    }];
    const photoMode = derivePhotoMode({ reportTier: 'full_pca', override: null });
    const { sections: numbered, appendix } = assignPhotoNumbers(sections as never);
    expect(photoMode).toBe('appendix');
    expect(appendix).toEqual([
      { photoNo: 1, key: 'a', url: '/p/a', caption: 'tile', sectionId: 's1', sectionTitle: 'Roof', itemId: 'i1', itemLabel: 'Covering' },
    ]);
    expect((numbered[0].items[0].photos as Array<{ photoNo: number }>)[0].photoNo).toBe(1);
  });

  it('defaults to inline mode (no override, non-full_pca tier) while still numbering photos', () => {
    const sections = [{
      id: 's1', title: 'Roof',
      items: [{ id: 'i1', label: 'Covering', photos: [{ key: 'a', url: '/p/a', caption: null }], resolvedTabs: { defects: [] } }],
    }];
    const photoMode = derivePhotoMode({ reportTier: 'light_commercial', override: null });
    const { appendix } = assignPhotoNumbers(sections as never);
    expect(photoMode).toBe('inline');
    // Numbering is computed unconditionally regardless of mode — the
    // renderer, not the numbering pass, decides whether to show it.
    expect(appendix).toHaveLength(1);
  });
});
