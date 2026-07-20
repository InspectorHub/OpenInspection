import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { seedStarterContent } from '../../../server/services/starter-content.service';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({
    drizzle: vi.fn(),
}));

import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

describe('seedStarterContent seeds role profiles', () => {
  let fixture: ReturnType<typeof createTestDb>;
  let testDb: BetterSQLite3Database<typeof schema>;
  let sqlite: any;

  beforeEach(async () => {
    fixture = createTestDb();
    testDb = fixture.db;
    sqlite = fixture.sqlite;
    await setupSchema(sqlite);
    (mockDrizzle as any).mockReturnValue(testDb);

    // Seed a default tenant to satisfy foreign keys
    await testDb.insert(schema.tenants).values({
      id: 't1',
      name: 'Test Tenant',
      slug: 'test',
      createdAt: new Date(),
    });
  });

  afterEach(() => {
    sqlite.close();
    vi.clearAllMocks();
  });

  it('creates the 8 default role profiles for the tenant', async () => {
    await seedStarterContent({} as any, 't1');
    const rows = await testDb.select().from(schema.contactRoleProfiles)
      .where(eq(schema.contactRoleProfiles.tenantId, 't1'));
    expect(rows).toHaveLength(8);
  });
});
