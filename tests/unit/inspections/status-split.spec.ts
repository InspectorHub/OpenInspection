import { describe, it, expect } from 'vitest';
import {
  INSPECTION_STATUSES, INSPECTION_STATUS, isInspectionStatus, INSPECTION_STATUS_LABELS,
} from '../../../server/lib/status/inspection-status';
import {
  REPORT_STATUSES, REPORT_STATUS, isReportStatus, isReportPublished, REPORT_STATUS_LABELS,
} from '../../../server/lib/status/report-status';

describe('inspection-status source of truth', () => {
  it('exposes the 5 lifecycle statuses', () => {
    expect(INSPECTION_STATUSES).toEqual(['requested', 'scheduled', 'confirmed', 'completed', 'cancelled']);
  });
  it('named constants match the array', () => {
    expect(INSPECTION_STATUS.REQUESTED).toBe('requested');
    expect(INSPECTION_STATUS.CANCELLED).toBe('cancelled');
  });
  it('isInspectionStatus narrows correctly', () => {
    expect(isInspectionStatus('scheduled')).toBe(true);
    expect(isInspectionStatus('delivered')).toBe(false);
    expect(isInspectionStatus(null)).toBe(false);
  });
  it('has a label for every inspection status', () => {
    for (const s of INSPECTION_STATUSES) expect(INSPECTION_STATUS_LABELS[s]).toBeTruthy();
  });
});

describe('report-status source of truth', () => {
  it('exposes the 3 report statuses', () => {
    expect(REPORT_STATUSES).toEqual(['in_progress', 'submitted', 'published']);
  });
  it('isReportPublished only true for published', () => {
    expect(isReportPublished('published')).toBe(true);
    expect(isReportPublished('submitted')).toBe(false);
    expect(isReportPublished('in_progress')).toBe(false);
    expect(isReportPublished(undefined)).toBe(false);
  });
  it('isReportStatus narrows', () => {
    expect(isReportStatus('submitted')).toBe(true);
    expect(isReportStatus('delivered')).toBe(false);
  });
  it('has a label for every report status', () => {
    for (const s of REPORT_STATUSES) expect(REPORT_STATUS_LABELS[s]).toBeTruthy();
  });
});
