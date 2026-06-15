// tests/unit/report-access-gate.spec.ts
import { describe, it, expect } from 'vitest';
import { publicReportAccessAllowed } from '../../server/lib/report-access';

describe('publicReportAccessAllowed', () => {
  it('client token: allowed only when published', () => {
    expect(publicReportAccessAllowed({ renderMode: false, ownerPreview: false, reportStatus: 'published' })).toBe(true);
    expect(publicReportAccessAllowed({ renderMode: false, ownerPreview: false, reportStatus: 'in_progress' })).toBe(false);
    expect(publicReportAccessAllowed({ renderMode: false, ownerPreview: false, reportStatus: 'submitted' })).toBe(false);
  });
  it('render mode bypasses (drafts must render headless)', () => {
    expect(publicReportAccessAllowed({ renderMode: true, ownerPreview: false, reportStatus: 'in_progress' })).toBe(true);
  });
  it('owner preview bypasses', () => {
    expect(publicReportAccessAllowed({ renderMode: false, ownerPreview: true, reportStatus: 'in_progress' })).toBe(true);
  });
});
