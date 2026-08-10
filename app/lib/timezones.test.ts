import { describe, it, expect } from 'vitest';
import {
  TIMEZONE_OPTIONS,
  timeZoneLabel,
  timeZoneOffsetMinutes,
  onboardingTzPrefill,
} from './timezones';
// The 419-entry table moved out of `timezones.ts` so that importing a cheap
// helper stops building it (#99). Its own specs stay here — the split changed
// where it lives, not what it must produce.
import { TIMEZONE_SELECT_OPTIONS } from './timezone-options';

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

  it('a passed-in offset produces the same text as resolving it again', () => {
    // The whole point of the second parameter. If these two ever disagree, the
    // optimisation below has changed what users read, which is the one thing it
    // is not allowed to do.
    for (const tz of ['UTC', 'Asia/Shanghai', 'America/New_York', 'Asia/Kolkata', 'Pacific/Chatham']) {
      expect(timeZoneLabel(tz, timeZoneOffsetMinutes(tz)), tz).toBe(timeZoneLabel(tz));
    }
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

  it('every label matches what recomputing the offset would produce', () => {
    // The table threads the offset it computed for the sort into the label
    // instead of resolving each zone a second time. That halves the
    // `Intl.DateTimeFormat` constructions this module performs at import — a
    // cost paid on the server per isolate AND in the browser during hydration
    // of any route whose chunk graph reaches here.
    //
    // The saving is only allowed to be invisible. This checks ALL of them, not
    // a sample: a mismatch would be one zone reading wrong in the picker, which
    // is exactly the kind of thing three spot-checks miss.
    for (const o of TIMEZONE_SELECT_OPTIONS) {
      expect(o.label, o.value).toBe(timeZoneLabel(o.value));
    }
  });

  it('is sorted west→east by current UTC offset', () => {
    const offsets = TIMEZONE_SELECT_OPTIONS.map((o) => timeZoneOffsetMinutes(o.value));
    for (let i = 1; i < offsets.length; i++) {
      expect(offsets[i]).toBeGreaterThanOrEqual(offsets[i - 1]);
    }
  });
});

describe('onboardingTzPrefill', () => {
  const CHI = 'America/Chicago'; // canonical, in TIMEZONE_OPTIONS

  it('suggests the browser zone on the onboarding step when the tenant is still on UTC', () => {
    expect(onboardingTzPrefill({ isTimezoneSetup: true, storedTz: 'UTC', browserTz: CHI })).toBe(CHI);
    expect(onboardingTzPrefill({ isTimezoneSetup: true, storedTz: null, browserTz: CHI })).toBe(CHI);
  });

  it('does nothing off the onboarding step (no ?setup=timezone marker)', () => {
    expect(onboardingTzPrefill({ isTimezoneSetup: false, storedTz: 'UTC', browserTz: CHI })).toBeNull();
  });

  it('never overrides a tenant that already chose a real zone', () => {
    expect(onboardingTzPrefill({ isTimezoneSetup: true, storedTz: 'America/Denver', browserTz: CHI })).toBeNull();
  });

  it('does nothing when the browser is UTC or unknown', () => {
    expect(onboardingTzPrefill({ isTimezoneSetup: true, storedTz: 'UTC', browserTz: 'UTC' })).toBeNull();
    expect(onboardingTzPrefill({ isTimezoneSetup: true, storedTz: 'UTC', browserTz: null })).toBeNull();
  });

  it('skips a non-canonical/alias zone the picker cannot represent', () => {
    expect(onboardingTzPrefill({ isTimezoneSetup: true, storedTz: 'UTC', browserTz: 'Not/AZone' })).toBeNull();
  });
});
