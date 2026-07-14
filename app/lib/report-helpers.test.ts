import { describe, it, expect } from 'vitest';
import { formatEpochMs, formatUnixSeconds } from './report-helpers';

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
