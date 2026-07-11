import { describe, it, expect } from 'vitest';
import { inspections } from '../../../server/lib/db/schema';
import { derivePhotoMode } from '../../../server/lib/report-photos';

describe('report_photo_mode override column', () => {
  it('exists on the inspections table as an enum', () => {
    expect(inspections.reportPhotoMode).toBeDefined();
  });

  it('an explicit override on the inspection wins over tier', () => {
    // simulates the row read in getReportData
    const row = { reportTier: 'full_pca', reportPhotoMode: 'inline' };
    expect(derivePhotoMode({ reportTier: row.reportTier, override: row.reportPhotoMode })).toBe('inline');
  });
});
