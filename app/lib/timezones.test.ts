import { describe, it, expect } from 'vitest';
import {
  TIMEZONE_OPTIONS,
  TIMEZONE_SELECT_OPTIONS,
  timeZoneLabel,
  timeZoneOffsetMinutes,
} from './timezones';

describe('TIMEZONE_OPTIONS', () => {
  it('is a non-empty list including common US zones', () => {
    expect(TIMEZONE_OPTIONS.length).toBeGreaterThan(50);
    expect(TIMEZONE_OPTIONS).toContain('America/New_York');
    expect(TIMEZONE_OPTIONS).toContain('UTC');
  });
});

describe('timeZoneOffsetMinutes', () => {
  it('is 0 for UTC', () => {
    expect(timeZoneOffsetMinutes('UTC')).toBe(0);
  });

  it('matches a fixed-offset zone regardless of DST (Asia/Shanghai = +08:00)', () => {
    // China has no DST, so the offset is stable at +480 minutes year-round.
    expect(timeZoneOffsetMinutes('Asia/Shanghai', new Date('2026-01-15T00:00:00Z'))).toBe(480);
    expect(timeZoneOffsetMinutes('Asia/Shanghai', new Date('2026-07-15T00:00:00Z'))).toBe(480);
  });

  it('is negative for the Americas (Los Angeles is behind UTC)', () => {
    expect(timeZoneOffsetMinutes('America/Los_Angeles', new Date('2026-01-15T00:00:00Z'))).toBeLessThan(0);
  });
});

describe('timeZoneLabel', () => {
  it('renders the mainstream `(UTC±HH:MM) City` shape', () => {
    expect(timeZoneLabel('UTC')).toBe('(UTC+00:00) UTC');
    expect(timeZoneLabel('Asia/Shanghai')).toBe('(UTC+08:00) Asia/Shanghai');
  });

  it('spaces underscores out of the IANA id', () => {
    expect(timeZoneLabel('America/New_York')).toContain('America/New York');
    expect(timeZoneLabel('America/New_York')).not.toContain('_');
  });
});

describe('TIMEZONE_SELECT_OPTIONS', () => {
  it('carries the raw IANA id as value and the offset label as text', () => {
    const utc = TIMEZONE_SELECT_OPTIONS.find((o) => o.value === 'UTC');
    expect(utc).toEqual({ value: 'UTC', label: '(UTC+00:00) UTC' });
  });

  it('covers every id in TIMEZONE_OPTIONS exactly once', () => {
    expect(TIMEZONE_SELECT_OPTIONS.length).toBe(TIMEZONE_OPTIONS.length);
    expect(new Set(TIMEZONE_SELECT_OPTIONS.map((o) => o.value)).size).toBe(TIMEZONE_OPTIONS.length);
  });

  it('is sorted west→east by current UTC offset', () => {
    const offsets = TIMEZONE_SELECT_OPTIONS.map((o) => timeZoneOffsetMinutes(o.value));
    for (let i = 1; i < offsets.length; i++) {
      expect(offsets[i]).toBeGreaterThanOrEqual(offsets[i - 1]);
    }
  });
});
