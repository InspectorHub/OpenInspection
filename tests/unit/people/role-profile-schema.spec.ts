import { describe, it, expect } from 'vitest';
import { CreateRoleProfileSchema, UpdateRoleProfileSchema } from '../../../server/lib/validations/role-profile.schema';

describe('role-profile schemas', () => {
  it('create requires label + valid kind', () => {
    expect(CreateRoleProfileSchema.safeParse({ label: 'Buyer Attorney', kind: 'other' }).success).toBe(true);
    expect(CreateRoleProfileSchema.safeParse({ label: '', kind: 'other' }).success).toBe(false);
    expect(CreateRoleProfileSchema.safeParse({ label: 'X', kind: 'bogus' }).success).toBe(false);
  });
  it('update cannot change kind or key', () => {
    const parsed = UpdateRoleProfileSchema.parse({ label: 'New', kind: 'client', key: 'x' } as any);
    expect('kind' in parsed).toBe(false);
    expect('key' in parsed).toBe(false);
  });
});
