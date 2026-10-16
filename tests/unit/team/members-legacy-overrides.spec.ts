/**
 * The Team page seeds its edit drawer from the overrides the member list returns.
 * A row that still carries the retired `financial` key must come back as the two
 * keys that replaced it, otherwise the drawer would show the role default and
 * saving it would silently drop the stored restriction.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { TeamService } from '../../../server/services/team.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '11111111-1111-1111-1111-1111111111a1';

describe('TeamService.getMembers reads a legacy financial override through', () => {
  let db: BetterSQLite3Database<typeof schema>;

  beforeEach(async () => {
    const fix = createTestDb();
    db = fix.db;
    await setupSchema(fix.sqlite);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockDrizzle as any).mockReturnValue(db);
    await db.insert(schema.tenants).values({ id: TENANT, slug: 'a', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() });
    await db.insert(schema.users).values([
      { id: 'u-legacy', tenantId: TENANT, email: 'legacy@a.test', name: 'Legacy', role: 'manager', passwordHash: 'x', createdAt: new Date(), permissionOverrides: { financial: false } as never },
      { id: 'u-new', tenantId: TENANT, email: 'new@a.test', name: 'New', role: 'inspector', passwordHash: 'x', createdAt: new Date(), permissionOverrides: { companyFinance: true } },
      { id: 'u-none', tenantId: TENANT, email: 'none@a.test', name: 'None', role: 'inspector', passwordHash: 'x', createdAt: new Date() },
    ]);
    await db.insert(schema.tenantInvites).values({
      id: 'tok-legacy', tenantId: TENANT, email: 'invited@a.test', role: 'inspector', status: 'pending',
      expiresAt: new Date(Date.now() + 1_000_000), invitedBy: 'u-legacy', permissionOverrides: { financial: true },
    } as never);
  });

  it('a member row with {financial:false} returns both new keys false, and no financial key', async () => {
    const { activeUsers } = await new TeamService({} as D1Database).getMembers(TENANT);
    const legacy = activeUsers.find(u => u.id === 'u-legacy');
    expect(legacy?.permissionOverrides).toEqual({ inspectionFees: false, companyFinance: false });
  });

  it('rows with new keys, or with nothing, are returned as they were', async () => {
    const { activeUsers } = await new TeamService({} as D1Database).getMembers(TENANT);
    expect(activeUsers.find(u => u.id === 'u-new')?.permissionOverrides).toEqual({ companyFinance: true });
    expect(activeUsers.find(u => u.id === 'u-none')?.permissionOverrides ?? null).toBeNull();
  });

  it('a pending invite with {financial:true} returns both new keys true', async () => {
    const { pendingInvites } = await new TeamService({} as D1Database).getMembers(TENANT);
    expect(pendingInvites[0]?.permissionOverrides).toEqual({ inspectionFees: true, companyFinance: true });
  });
});
