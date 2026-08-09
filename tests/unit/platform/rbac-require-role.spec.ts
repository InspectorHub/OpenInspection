import { describe, it, expect } from 'vitest';
import { requireRole } from '../../../server/lib/middleware/rbac';

function ctx(role: string | undefined) {
  return { get: (k: string) => (k === 'userRole' ? role : undefined) } as any;
}

describe('requireRole', () => {
  it('calls next when the user role is allowed', async () => {
    // 'manager', not 'admin': ROLES is owner|manager|inspector|agent
    // (server/lib/auth/roles.ts), so the case that claimed to prove "an ALLOWED
    // role calls next" was passing a role no real JWT can carry and no
    // allow-list can legitimately contain. What it is actually for -- the
    // SECOND entry of a multi-role allow-list matching -- still holds.
    let called = false;
    await requireRole('owner', 'manager')(ctx('manager'), async () => { called = true; });
    expect(called).toBe(true);
  });
  it('throws Forbidden when the role is not allowed', async () => {
    await expect(requireRole('owner')(ctx('inspector'), async () => {})).rejects.toThrow();
  });
  it('throws Unauthorized when no role on context', async () => {
    await expect(requireRole('owner')(ctx(undefined), async () => {})).rejects.toThrow();
  });
});
