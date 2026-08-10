/**
 * TeamService.updateMember — IA-101.
 *
 * The Team page's "Edit" button had no onClick, so a role could only be
 * corrected by removing the member and re-inviting them. This is the service
 * behind it, and most of what matters here is what it REFUSES to do.
 *
 * The session-invalidation assertions are the important ones. The role is a
 * JWT claim (jwt-claims.ts) and jwtAuthMiddleware never re-reads the users
 * row, so a demotion written only to D1 would sit inert for up to the token's
 * full 24h life: the UI would show the new role while the API kept honouring
 * the old one. Writing the `pwchanged` marker is what makes the change real.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { TeamService } from '../../../server/services/team.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { Role } from '../../../server/lib/auth/roles';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '11111111-1111-1111-1111-1111111111a1';
const OWNER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
const OWNER_2 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
const MANAGER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1';
const INSPECTOR = 'cccccccc-cccc-cccc-cccc-ccccccccccc1';

function userRow(id: string, role: Role, email: string) {
  return { id, tenantId: TENANT, email, name: email, role, passwordHash: 'x', createdAt: new Date() };
}

async function seed(db: BetterSQLite3Database<typeof schema>, extraOwner = false) {
  await db.insert(schema.tenants).values([
    { id: TENANT, name: 'A', slug: 'a', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
  ]);
  const rows = [
    userRow(OWNER, 'owner', 'owner@a.test'),
    userRow(MANAGER, 'manager', 'manager@a.test'),
    userRow(INSPECTOR, 'inspector', 'inspector@a.test'),
  ];
  if (extraOwner) rows.push(userRow(OWNER_2, 'owner', 'owner2@a.test'));
  await db.insert(schema.users).values(rows);
}

/** Minimal KV double so we can assert the session-invalidation write. */
function fakeKv() {
  const puts: string[] = [];
  return {
    puts,
    kv: { put: vi.fn(async (key: string) => { puts.push(key); }) } as unknown as KVNamespace,
  };
}

describe('TeamService.updateMember', () => {
  let db: BetterSQLite3Database<typeof schema>;

  beforeEach(async () => {
    const fix = createTestDb();
    db = fix.db;
    await setupSchema(fix.sqlite);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockDrizzle as any).mockReturnValue(db);
  });

  async function roleOf(id: string) {
    const row = await db.select({ role: schema.users.role }).from(schema.users).where(eq(schema.users.id, id)).get();
    return row?.role;
  }

  it('changes a role and ends that member\'s sessions so the new role is real', async () => {
    await seed(db);
    const { kv, puts } = fakeKv();
    const svc = new TeamService({} as D1Database, undefined, kv);

    await svc.updateMember({ tenantId: TENANT, userId: INSPECTOR, requesterId: OWNER, role: 'manager' });

    expect(await roleOf(INSPECTOR)).toBe('manager');
    // Without this the demoted/promoted member keeps their OLD claims until
    // their token expires — up to 24h of the wrong permissions.
    expect(puts).toContain(`pwchanged:${INSPECTOR}`);
  });

  it('does NOT sign anyone out for a capability-only change', async () => {
    await seed(db);
    const { kv, puts } = fakeKv();
    const svc = new TeamService({} as D1Database, undefined, kv);

    await svc.updateMember({
      tenantId: TENANT, userId: INSPECTOR, requesterId: OWNER,
      permissionOverrides: { financial: true },
    });

    // Overrides are read from the row per request, so they already apply.
    // Logging someone out for a checkbox would be gratuitous.
    expect(puts).toHaveLength(0);
    const row = await db.select({ o: schema.users.permissionOverrides }).from(schema.users).where(eq(schema.users.id, INSPECTOR)).get();
    expect(row?.o).toEqual({ financial: true });
  });

  it('stores only what differs from the role template', async () => {
    await seed(db);
    const svc = new TeamService({} as D1Database);

    // An inspector already has `publish`, so re-stating it is not an override
    // and must not be persisted — otherwise the row would pin a value that
    // then stops tracking the role template if that template ever changes.
    await svc.updateMember({
      tenantId: TENANT, userId: INSPECTOR, requesterId: OWNER,
      permissionOverrides: { publish: true },
    });

    const row = await db.select({ o: schema.users.permissionOverrides }).from(schema.users).where(eq(schema.users.id, INSPECTOR)).get();
    expect(row?.o).toBeNull();
  });

  it('diffs against the NEW role when the role moves in the same call', async () => {
    await seed(db);
    const svc = new TeamService({} as D1Database);

    // `financial` is false for an inspector but true for a manager. Promoting
    // to manager AND asking for financial must store nothing: it is the new
    // template's default. Diffing against the OLD role would persist a
    // redundant `{financial: true}` that outlives the reason for it.
    await svc.updateMember({
      tenantId: TENANT, userId: INSPECTOR, requesterId: OWNER,
      role: 'manager',
      permissionOverrides: { financial: true },
    });

    expect(await roleOf(INSPECTOR)).toBe('manager');
    const row = await db.select({ o: schema.users.permissionOverrides }).from(schema.users).where(eq(schema.users.id, INSPECTOR)).get();
    expect(row?.o).toBeNull();
  });

  it('refuses to change the last owner\'s role', async () => {
    await seed(db);
    const svc = new TeamService({} as D1Database);

    await expect(
      svc.updateMember({ tenantId: TENANT, userId: OWNER, requesterId: MANAGER, role: 'inspector' }),
    ).rejects.toThrow(/last owner/i);

    expect(await roleOf(OWNER)).toBe('owner');
  });

  it('allows demoting an owner when another owner remains', async () => {
    await seed(db, true);
    const svc = new TeamService({} as D1Database);

    await svc.updateMember({ tenantId: TENANT, userId: OWNER_2, requesterId: OWNER, role: 'manager' });
    expect(await roleOf(OWNER_2)).toBe('manager');
  });

  it('refuses to change your own role', async () => {
    await seed(db, true);
    const svc = new TeamService({} as D1Database);

    await expect(
      svc.updateMember({ tenantId: TENANT, userId: OWNER, requesterId: OWNER, role: 'inspector' }),
    ).rejects.toThrow(/your own role/i);
  });

  it('refuses to assign the agent role', async () => {
    await seed(db);
    const svc = new TeamService({} as D1Database);

    // An agent reaches an inspection through a per-inspection token that works
    // with no account. Minting one from the Team page would be a second,
    // contradictory route in — and would put them on the seat count.
    await expect(
      svc.updateMember({ tenantId: TENANT, userId: INSPECTOR, requesterId: OWNER, role: 'agent' }),
    ).rejects.toThrow(/agents are granted access/i);

    expect(await roleOf(INSPECTOR)).toBe('inspector');
  });

  it('will not reach across tenants', async () => {
    await seed(db);
    const svc = new TeamService({} as D1Database);

    await expect(
      svc.updateMember({
        tenantId: '99999999-9999-9999-9999-999999999999',
        userId: INSPECTOR, requesterId: OWNER, role: 'manager',
      }),
    ).rejects.toThrow(/not found/i);

    expect(await roleOf(INSPECTOR)).toBe('inspector');
  });
});
