import { describe, it, expect } from 'vitest';
import { requireRole } from '../../../server/lib/middleware/rbac';

function ctx(role: string | undefined) {
  return { get: (k: string) => (k === 'userRole' ? role : undefined) } as any;
}

describe('requireRole', () => {
  it('calls next when the user role is allowed', async () => {
    let called = false;
    await requireRole('owner', 'admin')(ctx('admin'), async () => { called = true; });
    expect(called).toBe(true);
  });
  it('throws Forbidden when the role is not allowed', async () => {
    await expect(requireRole('owner')(ctx('inspector'), async () => {})).rejects.toThrow();
  });
  it('throws Unauthorized when no role on context', async () => {
    await expect(requireRole('owner')(ctx(undefined), async () => {})).rejects.toThrow();
  });
});
