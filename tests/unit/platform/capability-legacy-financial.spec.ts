/**
 * Overrides stored before `financial` was split into `inspectionFees` and
 * `companyFinance` still sit in `users.permission_overrides` and in pending invites.
 * They are read through, never written back.
 */
import { describe, it, expect } from 'vitest';
import { coerceOverrides, getCapabilities } from '../../../server/lib/auth/capabilities';

describe('a stored `financial` override', () => {
  it('false becomes both new keys false (a manager who had finance switched off)', () => {
    expect(coerceOverrides({ financial: false })).toEqual({ inspectionFees: false, companyFinance: false });
    expect(getCapabilities('manager', coerceOverrides({ financial: false }))).toMatchObject({ inspectionFees: false, companyFinance: false });
  });
  it('true becomes both new keys true (an inspector who had finance switched on)', () => {
    expect(getCapabilities('inspector', coerceOverrides({ financial: true }))).toMatchObject({ inspectionFees: true, companyFinance: true });
  });
  it('an explicit new key wins over the legacy one', () => {
    expect(coerceOverrides({ financial: false, inspectionFees: true })).toEqual({ inspectionFees: true, companyFinance: false });
  });
  it('works for the JSON string some drivers hand back', () => {
    expect(coerceOverrides('{"financial":true}')).toEqual({ inspectionFees: true, companyFinance: true });
  });
  it('leaves other keys alone and ignores a non-boolean legacy value', () => {
    expect(coerceOverrides({ financial: false, publish: false })).toEqual({ inspectionFees: false, companyFinance: false, publish: false });
    expect(coerceOverrides({ financial: 'yes' })).toBeNull();
  });
  it('nothing stored stays nothing', () => {
    expect(coerceOverrides(null)).toBeNull();
    expect(coerceOverrides({})).toBeNull();
  });
});
