import { describe, it, expect, vi } from 'vitest';
import {
  isValidTimeZone,
  resolveTenantTimeZone,
  epochMsToRfc3339,
  wallClockToEpochMs,
  hasDeclaredTenantTimeZone,
  requireDeclaredTenantTimeZone,
  UNDECLARED_TENANT_TIMEZONE,
} from '../../../server/lib/tz';

describe('tz helper', () => {
  it('validates IANA names', () => {
    expect(isValidTimeZone('America/New_York')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    // Abbreviations / legacy fixed-offset zones are rejected — we store IANA
    // region ids only so the runtime always handles DST.
    expect(isValidTimeZone('EST')).toBe(false);
    expect(isValidTimeZone('GMT')).toBe(false);
    expect(isValidTimeZone('PST8PDT')).toBe(false);
    expect(isValidTimeZone('Not/AZone')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });

  it('resolveTenantTimeZone falls back to UTC on invalid/empty', () => {
    expect(resolveTenantTimeZone('America/Chicago')).toBe('America/Chicago');
    expect(resolveTenantTimeZone(null)).toBe('UTC');
    expect(resolveTenantTimeZone('garbage')).toBe('UTC');
  });

  it('epochMsToRfc3339 renders EST in January and EDT in July (DST handled by runtime)', () => {
    // 2026-01-15T14:00:00Z -> 09:00 EST (-05:00)
    expect(epochMsToRfc3339(Date.parse('2026-01-15T14:00:00Z'), 'America/New_York'))
      .toBe('2026-01-15T09:00:00-05:00');
    // 2026-07-15T13:00:00Z -> 09:00 EDT (-04:00)
    expect(epochMsToRfc3339(Date.parse('2026-07-15T13:00:00Z'), 'America/New_York'))
      .toBe('2026-07-15T09:00:00-04:00');
  });

  // West of Greenwich the wall-clock read as UTC is EARLIER than the instant it stands for, so on a day the clock changes
  // the offset at that first guess can still be the old one. Los Angeles changes at 09:00Z (fall back) and 10:00Z (spring).
  it('wallClockToEpochMs is right at 07:00 and 08:00 on the day the clock goes back in Los Angeles (after the change, PST)', () => {
    expect(wallClockToEpochMs('2026-11-01', '07:00', 'America/Los_Angeles')).toBe(Date.UTC(2026, 10, 1, 15, 0));
    expect(wallClockToEpochMs('2026-11-01', '08:00', 'America/Los_Angeles')).toBe(Date.UTC(2026, 10, 1, 16, 0));
  });

  it('wallClockToEpochMs is right at 07:00 on the day the clock goes forward in Los Angeles (after the change, PDT)', () => {
    expect(wallClockToEpochMs('2027-03-14', '07:00', 'America/Los_Angeles')).toBe(Date.UTC(2027, 2, 14, 14, 0));
  });

  // East of Greenwich the guess is LATER than the real instant, and the old single-guess answer was wrong there too.
  it.each([
    ['Europe/Berlin', '2026-10-25', '01:00', Date.UTC(2026, 9, 24, 23, 0)], // CEST, the hour before the clock goes back
    ['Europe/Berlin', '2027-03-28', '01:00', Date.UTC(2027, 2, 28, 0, 0)], // CET, the hour before the clock goes forward
    ['Australia/Sydney', '2026-10-04', '00:00', Date.UTC(2026, 9, 3, 14, 0)], // AEST
    ['Australia/Sydney', '2026-10-04', '01:00', Date.UTC(2026, 9, 3, 15, 0)], // AEST
    ['Australia/Sydney', '2027-04-04', '00:00', Date.UTC(2027, 3, 3, 13, 0)], // AEDT
    ['Australia/Sydney', '2027-04-04', '01:00', Date.UTC(2027, 3, 3, 14, 0)], // AEDT
  ])('wallClockToEpochMs is right east of Greenwich too: %s %s %s', (zone, date, hm, expected) => {
    expect(wallClockToEpochMs(date, hm, zone)).toBe(expected);
  });

  it('wallClockToEpochMs does not build a formatter per call (one per zone is enough)', () => {
    const Real = Intl.DateTimeFormat;
    // Count constructions but still build a real formatter (a bare spy on a constructor returns nothing usable).
    const spy = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (...args: ConstructorParameters<typeof Intl.DateTimeFormat>) {
      return new Real(...args);
    } as unknown as typeof Intl.DateTimeFormat);
    try {
      for (let i = 0; i < 6; i++) wallClockToEpochMs('2026-11-01', '09:00', 'Asia/Ulaanbaatar');
      // Each call needs 2-3 offsets; without a cache that is a new formatter every time.
      expect(spy.mock.calls.length).toBeLessThanOrEqual(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('wallClockToEpochMs control: times well before and after the change are unchanged', () => {
    expect(wallClockToEpochMs('2026-11-01', '00:30', 'America/Los_Angeles')).toBe(Date.UTC(2026, 10, 1, 7, 30)); // PDT
    expect(wallClockToEpochMs('2026-11-01', '12:00', 'America/Los_Angeles')).toBe(Date.UTC(2026, 10, 1, 20, 0)); // PST
  });

  it('wallClockToEpochMs interprets local wall-clock in the tenant zone', () => {
    // 09:00 local on 2026-07-15 in New York (EDT -04:00) == 13:00Z
    expect(wallClockToEpochMs('2026-07-15', '09:00', 'America/New_York'))
      .toBe(Date.parse('2026-07-15T13:00:00Z'));
    // 09:00 local on 2026-01-15 in New York (EST -05:00) == 14:00Z
    expect(wallClockToEpochMs('2026-01-15', '09:00', 'America/New_York'))
      .toBe(Date.parse('2026-01-15T14:00:00Z'));
  });
});

/**
 * THE SENTINEL, AND WHY IT NEEDS ITS OWN PREDICATE.
 *
 * `resolveTenantTimeZone` answers "which zone do we render in" and can never
 * answer "did anybody choose one" — the column is NOT NULL DEFAULT 'UTC', so the
 * never-configured workspace and the deliberately-UTC one are the same string.
 * Anything that mints an instant a client is told has to ask the second question,
 * and the pair below is the only place it can be asked.
 */
describe('declared-vs-default tenant timezone', () => {
  it('treats the NOT NULL default as "nobody declared a zone"', () => {
    expect(UNDECLARED_TENANT_TIMEZONE).toBe('UTC');
    expect(hasDeclaredTenantTimeZone('UTC')).toBe(false);
    expect(requireDeclaredTenantTimeZone('UTC')).toBeNull();
    // ...while the display resolver still answers the same thing it always did,
    // because a report still has to be rendered in some zone.
    expect(resolveTenantTimeZone('UTC')).toBe('UTC');
  });

  it('accepts Etc/UTC as a DELIBERATE UTC declaration', () => {
    // The escape hatch that keeps the rule from meaning "UTC is unsupported".
    expect(hasDeclaredTenantTimeZone('Etc/UTC')).toBe(true);
    expect(requireDeclaredTenantTimeZone('Etc/UTC')).toBe('Etc/UTC');
  });

  it('accepts a real region zone and rejects everything that is not one', () => {
    expect(hasDeclaredTenantTimeZone('America/Chicago')).toBe(true);
    expect(requireDeclaredTenantTimeZone('America/Chicago')).toBe('America/Chicago');
    for (const bad of [null, undefined, '', 'garbage', 'EST', 'PST8PDT']) {
      expect(hasDeclaredTenantTimeZone(bad)).toBe(false);
      expect(requireDeclaredTenantTimeZone(bad)).toBeNull();
    }
  });
});
