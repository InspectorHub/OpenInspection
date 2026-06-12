import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, setupSchema } from './db';
import { usageCounters } from '../../server/lib/db/schema/usage';

describe('usage_counters schema', () => {
  let testDb: ReturnType<typeof createTestDb>['db'];
  let sqlite: ReturnType<typeof createTestDb>['sqlite'];
  beforeEach(async () => {
    const s = createTestDb(); testDb = s.db; sqlite = s.sqlite; await setupSchema(sqlite);
  });
  it('persists and reads a counter row', async () => {
    await testDb.insert(usageCounters).values({ tenantId: 't1', metric: 'sms', periodKey: '2026-06', value: 3, updatedAt: new Date() });
    const rows = await testDb.select().from(usageCounters).where(eq(usageCounters.tenantId, 't1')).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.value).toBe(3);
  });
  it('enforces the composite primary key', async () => {
    await testDb.insert(usageCounters).values({ tenantId: 't1', metric: 'sms', periodKey: '2026-06', value: 1, updatedAt: new Date() });
    await expect(testDb.insert(usageCounters).values({ tenantId: 't1', metric: 'sms', periodKey: '2026-06', value: 9, updatedAt: new Date() })).rejects.toThrow();
  });
});
