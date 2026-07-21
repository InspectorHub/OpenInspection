import { describe, it, expect, beforeEach, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { TeamService } from '../../../server/services/team.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT_A = '11111111-1111-1111-1111-1111111111a1';
const TENANT_B = '22222222-2222-2222-2222-2222222222b2';
const PENDING  = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
const ACCEPTED = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1';
const OTHER_T  = 'cccccccc-cccc-cccc-cccc-ccccccccccc1';

async function seed(db: BetterSQLite3Database<typeof schema>) {
  await db.insert(schema.tenants).values([
    { id: TENANT_A, name: 'A', slug: 'a', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
    { id: TENANT_B, name: 'B', slug: 'b', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
  ]);
  await db.insert(schema.tenantInvites).values([
    { id: PENDING,  tenantId: TENANT_A, email: 'p@a.test', role: 'inspector', status: 'pending',  expiresAt: new Date(Date.now() + 1e9) },
    { id: ACCEPTED, tenantId: TENANT_A, email: 'x@a.test', role: 'inspector', status: 'accepted', expiresAt: new Date(Date.now() + 1e9) },
    { id: OTHER_T,  tenantId: TENANT_B, email: 'o@b.test', role: 'agent',     status: 'pending',  expiresAt: new Date(Date.now() + 1e9) },
  ]);
}

describe('TeamService.cancelInvite', () => {
  let db: BetterSQLite3Database<typeof schema>;
  let svc: TeamService;
  beforeEach(async () => {
    const fix = createTestDb();
    db = fix.db;
    await setupSchema(fix.sqlite);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockDrizzle as any).mockReturnValue(db);
    await seed(db);
    svc = new TeamService({} as D1Database);
  });

  it('hard-deletes a pending invite in the caller tenant', async () => {
    await svc.cancelInvite(TENANT_A, PENDING);
    const rows = await db.select().from(schema.tenantInvites).where(eq(schema.tenantInvites.id, PENDING)).all();
    expect(rows).toHaveLength(0);
  });

  it('rejects an accepted invite (not pending)', async () => {
    await expect(svc.cancelInvite(TENANT_A, ACCEPTED)).rejects.toThrow(/not found/i);
  });

  it('rejects a cross-tenant invite', async () => {
    await expect(svc.cancelInvite(TENANT_A, OTHER_T)).rejects.toThrow(/not found/i);
    const still = await db.select().from(schema.tenantInvites)
      .where(and(eq(schema.tenantInvites.id, OTHER_T), eq(schema.tenantInvites.tenantId, TENANT_B))).all();
    expect(still).toHaveLength(1);
  });

  it('rejects an unknown token', async () => {
    await expect(svc.cancelInvite(TENANT_A, '00000000-0000-0000-0000-000000000000')).rejects.toThrow(/not found/i);
  });

  it('findPendingInvite returns the email for a pending in-tenant invite', async () => {
    expect(await svc.findPendingInvite(TENANT_A, PENDING)).toEqual({ email: 'p@a.test' });
  });

  it('findPendingInvite returns null for accepted / cross-tenant / unknown', async () => {
    expect(await svc.findPendingInvite(TENANT_A, ACCEPTED)).toBeNull();
    expect(await svc.findPendingInvite(TENANT_A, OTHER_T)).toBeNull();
    expect(await svc.findPendingInvite(TENANT_A, '00000000-0000-0000-0000-000000000000')).toBeNull();
  });
});
