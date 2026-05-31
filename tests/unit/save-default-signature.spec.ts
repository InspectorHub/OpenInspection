import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as schema from '../../src/lib/db/schema';
import { createTestDb, setupSchema } from './db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { saveUserDefaultSignature } from '../../src/services/user.service';

const TENANT = '00000000-0000-0000-0000-000000000001';
const USER_ID = '00000000-0000-0000-0000-000000000300';
const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=';

describe('saveUserDefaultSignature', () => {
  let db: BetterSQLite3Database<typeof schema>;

  beforeEach(async () => {
    const fixture = createTestDb();
    db = fixture.db;
    await setupSchema(fixture.sqlite);
    await db.insert(schema.tenants).values({
      id: TENANT, name: 'A', subdomain: 's', status: 'active',
      deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await db.insert(schema.users).values({
      id: USER_ID, tenantId: TENANT, email: 'i@x', passwordHash: 'x',
      role: 'inspector', createdAt: new Date(),
    });
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
  });

  it('persists signature to users.default_signature_base64', async () => {
    await saveUserDefaultSignature({} as D1Database, USER_ID, SIG);
    const row = await db.select().from(schema.users).get();
    expect(row!.defaultSignatureBase64).toBe(SIG);
  });

  it('throws when user does not exist', async () => {
    await expect(
      saveUserDefaultSignature({} as D1Database, '00000000-0000-0000-0000-000000000999', SIG)
    ).rejects.toThrow(/not found/i);
  });
});
