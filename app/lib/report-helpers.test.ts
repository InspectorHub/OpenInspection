import { describe, it, expect } from 'vitest';
import { formatEpochMs, formatUnixSeconds, itemDrivesSummary } from './report-helpers';

// IA-66 — "Defects Only" filter + "Add to repair request" checkbox must agree,
// and both must honour the tenant's per-category drivesSummary switch (not a
// severityBucket regex that never matched custom categories).
describe('itemDrivesSummary', () => {
  const item = (defects: Array<{ drivesSummary?: boolean }>) =>
    ({ severityBucket: 'defect', resolvedTabs: { defects } }) as never;

  it('is true when any included defect drives the summary', () => {
    expect(itemDrivesSummary(item([{ drivesSummary: true }]))).toBe(true);
    expect(itemDrivesSummary(item([{ drivesSummary: false }, { drivesSummary: true }]))).toBe(true);
  });
  it('treats an unset drivesSummary as true (server default)', () => {
    expect(itemDrivesSummary(item([{}]))).toBe(true);
  });
  it('is false when every defect category is switched off', () => {
    expect(itemDrivesSummary(item([{ drivesSummary: false }]))).toBe(false);
  });
  it('is false for an item with no defects', () => {
    expect(itemDrivesSummary(item([]))).toBe(false);
    expect(itemDrivesSummary({ severityBucket: 'satisfactory' } as never)).toBe(false);
  });
});

describe('report-helpers timezone', () => {
  it('formatEpochMs renders in the supplied tenant tz', () => {
    // 2026-01-01T04:00:00Z is still Dec 31 in New York (EST -05:00)
    expect(formatEpochMs(Date.parse('2026-01-01T04:00:00Z'), 'America/New_York')).toContain('Dec 31');
    expect(formatEpochMs(Date.parse('2026-01-01T04:00:00Z'), 'UTC')).toContain('Jan 1');
  });
  it('formatEpochMs defaults to UTC when no tz given', () => {
    expect(formatEpochMs(Date.parse('2026-01-01T04:00:00Z'))).toContain('Jan 1');
  });
  it('formatUnixSeconds honors the tenant tz (no longer hardcoded UTC)', () => {
    const sec = Date.parse('2026-01-01T04:00:00Z') / 1000;
    expect(formatUnixSeconds(sec, 'America/New_York')).toContain('Dec 31');
    expect(formatUnixSeconds(sec, 'UTC')).toContain('Jan 1');
  });
  it('returns empty string on null/invalid', () => {
    expect(formatEpochMs(null)).toBe('');
    expect(formatEpochMs(undefined)).toBe('');
  });
});
