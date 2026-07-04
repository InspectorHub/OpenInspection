import { describe, it, expect } from 'vitest';
import { currentPeriodKey } from '../../../server/lib/usage/period';
describe('currentPeriodKey', () => {
  it('returns YYYY-MM in UTC', () => {
    expect(currentPeriodKey(new Date('2026-06-09T23:30:00Z'))).toBe('2026-06');
    expect(currentPeriodKey(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01');
  });
});
