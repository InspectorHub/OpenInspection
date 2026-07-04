import { describe, it, expect } from 'vitest';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { ROLES } from '../../../server/lib/auth/roles';
import { users, tenantInvites } from '../../../server/lib/db/schema';

function roleEnum(table: any): readonly string[] {
  const col = getTableConfig(table).columns.find((c: any) => c.name === 'role');
  return col?.enumValues ?? [];
}

describe('role enum drift', () => {
  it('users.role enum matches ROLES', () => {
    expect([...roleEnum(users)].sort()).toEqual([...ROLES].sort());
  });
  it('tenant_invites.role enum matches ROLES', () => {
    expect([...roleEnum(tenantInvites)].sort()).toEqual([...ROLES].sort());
  });
});
