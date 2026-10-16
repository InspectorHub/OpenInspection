import { describe, it, expect } from 'vitest';
import { ROLES, ROLE_LABELS, isRole } from '../../../server/lib/auth/roles';

describe('roles source-of-truth', () => {
  it('exposes exactly the five canonical roles', () => {
    expect([...ROLES]).toEqual(['owner', 'manager', 'inspector', 'staff', 'agent']);
  });

  it('has a label for every role', () => {
    for (const r of ROLES) expect(ROLE_LABELS[r]).toBeTruthy();
  });

  it('isRole narrows valid + rejects invalid values', () => {
    expect(isRole('owner')).toBe(true);
    expect(isRole('office_staff')).toBe(false);
    expect(isRole('lead')).toBe(false);
  });
});

import {
  ROLE, ROLE_TIER, FIELD_ROLES, NATIVE_APP_ROLES, countsTowardSeatQuota,
} from '../../../server/lib/auth/roles';

describe('the staff role', () => {
  it('sits at the inspector tier; the others evaluate as themselves', () => {
    expect(ROLE_TIER.staff).toBe(ROLE.INSPECTOR);
    for (const r of ['owner', 'manager', 'inspector', 'agent'] as const) expect(ROLE_TIER[r]).toBe(r);
  });

  it('field roles are the ones that can lead an inspection', () => {
    expect([...FIELD_ROLES]).toEqual(['owner', 'manager', 'inspector']);
    expect(FIELD_ROLES as readonly string[]).not.toContain('staff');
  });

  it('the native app admits the field roles and staff, never agent', () => {
    expect([...NATIVE_APP_ROLES].sort()).toEqual(['inspector', 'manager', 'owner', 'staff']);
  });

  it.each([
    ['owner', true], ['manager', true], ['inspector', true], ['agent', true],
    // Staff are office users and are decided in this one function.
    ['staff', false],
  ] as const)('countsTowardSeatQuota(%s) -> %s', (role, expected) => {
    expect(countsTowardSeatQuota(role)).toBe(expected);
  });
});
