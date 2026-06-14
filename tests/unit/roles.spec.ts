import { describe, it, expect } from 'vitest';
import { ROLES, ROLE_LABELS, isRole } from '../../server/lib/auth/roles';

describe('roles source-of-truth', () => {
  it('exposes exactly the four canonical roles', () => {
    expect([...ROLES]).toEqual(['owner', 'manager', 'inspector', 'agent']);
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
