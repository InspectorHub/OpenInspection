import { describe, it, expect } from 'vitest';
import { epochMsToRfc3339 } from '../../../server/lib/tz';

/**
 * Guards the runtime assumption the whole timezone feature rests on: the CF
 * Workers V8/ICU runtime must carry full IANA data and switch DST by date. If
 * this ever fails, the runtime lacks tz data and no amount of app code fixes it.
 */
describe('runtime DST handling', () => {
  it('America/New_York is EST (-05:00) in January and EDT (-04:00) in July', () => {
    expect(epochMsToRfc3339(Date.parse('2026-01-15T12:00:00Z'), 'America/New_York')).toContain('-05:00');
    expect(epochMsToRfc3339(Date.parse('2026-07-15T12:00:00Z'), 'America/New_York')).toContain('-04:00');
  });
  it('Australia/Sydney is +11:00 in January and +10:00 in July (southern DST)', () => {
    expect(epochMsToRfc3339(Date.parse('2026-01-15T00:00:00Z'), 'Australia/Sydney')).toContain('+11:00');
    expect(epochMsToRfc3339(Date.parse('2026-07-15T00:00:00Z'), 'Australia/Sydney')).toContain('+10:00');
  });
  it('UTC has no offset shift across the year', () => {
    expect(epochMsToRfc3339(Date.parse('2026-01-15T12:00:00Z'), 'UTC')).toContain('+00:00');
    expect(epochMsToRfc3339(Date.parse('2026-07-15T12:00:00Z'), 'UTC')).toContain('+00:00');
  });
});
