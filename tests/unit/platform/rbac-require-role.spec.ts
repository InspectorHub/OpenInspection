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

/**
 * The staff role is evaluated at the inspector tier. Driven through a real Hono
 * app so the method the gate sees is the method a request carries.
 */
import { Hono } from 'hono';
import type { Role } from '../../../server/lib/auth/roles';

type GateName = 'inspector' | 'manager';
const GATES: Record<GateName, ReturnType<typeof requireRole>> = {
  inspector: requireRole('owner', 'manager', 'inspector'),
  manager: requireRole('owner', 'manager'),
};

async function run(
  gate: ReturnType<typeof requireRole>,
  role: Role,
  method: string,
): Promise<number> {
  const app = new Hono<{ Variables: { userRole: Role } }>();
  app.onError((err, c) => {
    const status = (err as { status?: number }).status;
    return c.json({ error: err.message }, (status ?? 500) as 401 | 403 | 500);
  });
  app.use('*', async (c, next) => { c.set('userRole', role); await next(); });
  // The gate is typed against the app's Context<HonoConfig>; the test app only
  // carries `userRole`, which is all the gate reads.
  app.all('/x', gate as never, (c) => c.json({ ok: true }));
  const res = await app.request('/x', { method });
  return res.status;
}

describe('requireRole: the staff tier', () => {
  const MATRIX: Array<[Role, GateName, string, number]> = [
    ['staff', 'inspector', 'GET', 200],
    ['staff', 'inspector', 'POST', 200],
    ['staff', 'manager', 'GET', 403],
    ['staff', 'manager', 'POST', 403],
    // Positive controls for the other roles.
    ['inspector', 'inspector', 'POST', 200],
    ['manager', 'manager', 'POST', 200],
    ['owner', 'manager', 'DELETE', 200],
  ];
  it.each(MATRIX)('%s on the %s gate with %s -> %i', async (role, gate, method, status) => {
    expect(await run(GATES[gate], role, method)).toBe(status);
  });

  it('a gate that lists staff explicitly lets staff write', async () => {
    expect(await run(requireRole('staff'), 'staff', 'POST')).toBe(200);
  });

  it('agent never inherits the inspector tier', async () => {
    expect(await run(GATES.inspector, 'agent', 'GET')).toBe(403);
  });
});
