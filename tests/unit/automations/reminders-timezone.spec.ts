import { describe, it, expect } from 'vitest';
import { wallClockToEpochMs } from '../../../server/lib/tz';

/**
 * Contract guard for the appointment-reminder anchor. The reminder fires at
 * 09:00 LOCAL in the tenant timezone (was tz-naive 09:00 UTC). inspections.date
 * is a calendar date (YYYY-MM-DD, no tz); wallClockToEpochMs interprets 09:00 in
 * the tenant zone. 09:00 is clear of the DST transition window.
 */
describe('reminder anchor (09:00 local in tenant tz)', () => {
  it('09:00 local in America/New_York (EDT) is 13:00Z', () => {
    expect(wallClockToEpochMs('2026-07-15', '09:00', 'America/New_York'))
      .toBe(Date.parse('2026-07-15T13:00:00Z'));
  });
  it('09:00 local in America/Los_Angeles (PDT) is 16:00Z', () => {
    expect(wallClockToEpochMs('2026-07-15', '09:00', 'America/Los_Angeles'))
      .toBe(Date.parse('2026-07-15T16:00:00Z'));
  });
  it('UTC tenant keeps 09:00 == 09:00Z (unchanged from the legacy anchor)', () => {
    expect(wallClockToEpochMs('2026-07-15', '09:00', 'UTC'))
      .toBe(Date.parse('2026-07-15T09:00:00Z'));
  });
});
