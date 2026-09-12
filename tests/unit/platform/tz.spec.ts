import { describe, it, expect } from 'vitest';
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
