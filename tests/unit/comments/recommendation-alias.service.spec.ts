import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RecommendationService } from '../../../server/services/recommendation.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const T = '00000000-0000-0000-0000-000000000001';

describe('RecommendationService (alias over comments)', () => {
  let svc: RecommendationService;
  let testDb: BetterSQLite3Database<typeof schema>;

  beforeEach(async () => {
    const f = createTestDb(); testDb = f.db; await setupSchema(f.sqlite);
    await testDb.insert(schema.tenants).values({ id: T, name: 'A', slug: 'a', status: 'active', deploymentMode: 'shared', tier: 'free', maxUsers: 5, appliedCmdSeq: 0, appliedCredSeq: 0, createdAt: new Date() });
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
    svc = new RecommendationService({} as D1Database);
  });

  it('create writes a defect comment with repair fields; list returns only repair-item comments', async () => {
    // A plain non-repair comment must NOT appear in the recommendation list.
    // `created_at` is NOT NULL (no default) on the comments table — supply it.
    await testDb.insert(schema.comments).values({ id: 'c-plain', tenantId: T, text: 'Just a note', severity: 'good', createdAt: new Date() });

    const rec = await svc.create(T, { name: 'Fix gutter', severity: 'significant', defaultEstimateMin: 10000, defaultEstimateMax: 30000, defaultRepairSummary: 'Reattach gutter' });
    expect(rec.name).toBe('Fix gutter');

    const list = await svc.listByTenant(T);
    expect(list.map(r => r.name)).toEqual(['Fix gutter']); // c-plain excluded

    // It is physically stored as a comment with repair fields.
    const c = await testDb.select().from(schema.comments).where(eq(schema.comments.id, rec.id)).get();
    expect(c?.repairSummary).toBe('Reattach gutter');
    expect(c?.severity).toBe('significant');
  });
});
