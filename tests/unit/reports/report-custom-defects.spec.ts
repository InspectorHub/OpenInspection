import { describe, it, expect } from 'vitest';
import { mapCustomDefectsForReport } from '../../../server/lib/report-utils';

/**
 * FE-3/B-20 gap — custom (per-inspection) defects lived only in
 * inspection_results.data[itemId].customComments and were consumed by the
 * repair list + dashboard stats, but getReportData never surfaced them: the
 * published report silently dropped every field-authored defect. This maps
 * them into the same resolved shape as canned defects (effectiveComment /
 * effectiveCategory / defectPhotos) so the viewer renders one list.
 */
describe('mapCustomDefectsForReport', () => {
  const mkUrl = (key: string) => `/photo?key=${key}`;

  it('maps an included custom defect into the resolved-defect shape', () => {
    const out = mapCustomDefectsForReport(
      {
        defects: [
          {
            id: 'c1',
            title: 'Water stain at sheathing',
            comment: 'Staining near chimney.',
            included: true,
            category: 'recommendation',
            location: 'NE corner',
            photos: [{ key: 'k1' }, { key: 'k2', annotatedKey: 'k2a' }],
          },
        ],
      },
      mkUrl,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: 'c1',
      title: 'Water stain at sheathing',
      included: true,
      isCustom: true,
      effectiveComment: 'Staining near chimney.',
      effectiveCategory: 'recommendation',
      effectiveLocation: 'NE corner',
    });
    // annotated composite preferred, original exposed
    expect(out[0].defectPhotos).toEqual([
      { key: 'k1', originalKey: 'k1', url: '/photo?key=k1' },
      { key: 'k2a', originalKey: 'k2', url: '/photo?key=k2a' },
    ]);
  });

  it('keeps excluded custom defects out (report renders included only) but flags inclusion', () => {
    const out = mapCustomDefectsForReport(
      { defects: [{ id: 'c1', title: 'X', included: false }] },
      mkUrl,
    );
    expect(out).toHaveLength(1);
    expect(out[0].included).toBe(false);
  });

  it('defaults category to maintenance-free recommendation and tolerates missing fields', () => {
    const out = mapCustomDefectsForReport({ defects: [{ id: 'c2', title: 'Y' }] }, mkUrl);
    expect(out[0]).toMatchObject({
      included: true,
      effectiveCategory: 'recommendation',
      effectiveComment: '',
      defectPhotos: [],
    });
  });

  it('returns [] for empty/missing payloads', () => {
    expect(mapCustomDefectsForReport(undefined, mkUrl)).toEqual([]);
    expect(mapCustomDefectsForReport({}, mkUrl)).toEqual([]);
  });
});
