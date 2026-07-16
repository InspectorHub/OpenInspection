import { describe, it, expect } from 'vitest';
import { assertAdminOrForbidden } from '~/lib/access';

describe('settings-booking access', () => {
  it('forbids inspector from company booking settings', () => {
    expect(assertAdminOrForbidden('inspector').forbidden).toBe(true);
  });
  it('allows owner', () => {
    expect(assertAdminOrForbidden('owner').forbidden).toBe(false);
  });
  it('allows manager', () => {
    expect(assertAdminOrForbidden('manager').forbidden).toBe(false);
  });
});
