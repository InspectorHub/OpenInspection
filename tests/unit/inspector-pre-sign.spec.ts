import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as schema from '../../server/lib/db/schema';
import { createTestDb, setupSchema } from './db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { applyInspectorPreSign } from '../../server/services/agreement.service';

const TENANT = '00000000-0000-0000-0000-000000000001';
const REQ_ID = '00000000-0000-0000-0000-000000000200';
const USER_ID = '00000000-0000-0000-0000-000000000300';
const AGR_ID = '00000000-0000-0000-0000-000000000020';
const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=';

describe('applyInspectorPreSign', () => {
  let db: BetterSQLite3Database<typeof schema>;

  beforeEach(async () => {
    const fixture = createTestDb();
    db = fixture.db;
    await setupSchema(fixture.sqlite);
    await db.insert(schema.tenants).values({
      id: TENANT, name: 'A', slug: 's', status: 'active',
      deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await db.insert(schema.users).values({
      id: USER_ID, tenantId: TENANT, email: 'i@x', passwordHash: 'x',
      role: 'inspector', createdAt: new Date(),
    });
    await db.insert(schema.agreements).values({
      id: AGR_ID, tenantId: TENANT, name: 'A', content: 'x', version: 1, createdAt: new Date(),
    });
    await db.insert(schema.agreementRequests).values({
      id: REQ_ID, tenantId: TENANT, agreementId: AGR_ID,
      clientEmail: 'c@x', token: 'tk', status: 'pending', createdAt: new Date(),
    });
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
  });

  it('persists inspector signature + userId + signedAt', async () => {
    await applyInspectorPreSign({} as D1Database, TENANT, REQ_ID, USER_ID, SIG);
    const row = await db.select().from(schema.agreementRequests).get();
    expect(row!.inspectorSignatureBase64).toBe(SIG);
    expect(row!.inspectorUserId).toBe(USER_ID);
    expect(row!.inspectorSignedAt).toBeTruthy();
  });

  it('throws when envelope is not in pending status', async () => {
    await db.update(schema.agreementRequests).set({ status: 'sent' });
    await expect(
      applyInspectorPreSign({} as D1Database, TENANT, REQ_ID, USER_ID, SIG)
    ).rejects.toThrow(/can only pre-sign while status is pending/i);
  });

  it('refuses cross-tenant access (envelope not found)', async () => {
    await expect(
      applyInspectorPreSign({} as D1Database, '00000000-0000-0000-0000-000000000099', REQ_ID, USER_ID, SIG)
    ).rejects.toThrow(/not found/i);
  });
});
