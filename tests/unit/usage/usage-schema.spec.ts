import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, setupSchema } from '../db';
import { usageCounters } from '../../../server/lib/db/schema/usage';
import type { UsageMetric } from '../../../server/lib/usage/period';

/**
 * The metric list exists twice — as the column's drizzle enum and as the
 * `UsageMetric` union — and the two must agree or a recorded metric becomes
 * unreadable through the typed handle. Executable coupling instead of a
 * "keep these in sync" comment: the Record below fails TYPE-CHECK if the union
 * grows a member it does not name, and the equality below fails at RUNTIME if
 * the column enum drifts from it.
 */
const UNION_METRICS: Record<UsageMetric, true> = {
  sms: true, email: true, r2_bytes: true, inspections: true,
  sms_byo: true, email_byo: true,
  ai_translate: true, ai_translate_byo: true,
  ai_assist: true, ai_assist_byo: true,
};

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
  it('the column enum and the UsageMetric union list the same metrics', () => {
    expect([...usageCounters.metric.enumValues].sort()).toEqual(Object.keys(UNION_METRICS).sort());
  });
  it('persists every AI metric through the typed handle', async () => {
    // A metric the column enum rejects is a counter that can be written by the
    // raw path and never read back by the typed one.
    for (const metric of ['ai_translate', 'ai_translate_byo', 'ai_assist', 'ai_assist_byo'] as const) {
      await testDb.insert(usageCounters).values({ tenantId: 't1', metric, periodKey: '2026-06', value: 1, updatedAt: new Date() });
    }
    const rows = await testDb.select().from(usageCounters).where(eq(usageCounters.tenantId, 't1')).all();
    expect(rows.map(r => r.metric).sort()).toEqual(['ai_assist', 'ai_assist_byo', 'ai_translate', 'ai_translate_byo']);
  });
  it('enforces the composite primary key', async () => {
    await testDb.insert(usageCounters).values({ tenantId: 't1', metric: 'sms', periodKey: '2026-06', value: 1, updatedAt: new Date() });
    await expect(testDb.insert(usageCounters).values({ tenantId: 't1', metric: 'sms', periodKey: '2026-06', value: 9, updatedAt: new Date() })).rejects.toThrow();
  });
});
