import { describe, it, expect, beforeEach } from 'vitest';
import { RecommendationService } from '../../../server/services/recommendation.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';

import { lazyD1 } from '../helpers/d1-binding';
const testD1 = lazyD1();

const T = '00000000-0000-0000-0000-000000000001';

describe('RecommendationService — contractor type', () => {
  let svc: RecommendationService;
  let testDb: BetterSQLite3Database<typeof schema>;

  beforeEach(async () => {
    const f = createTestDb(); testDb = f.db; await setupSchema(f.sqlite);
    await testDb.insert(schema.tenants).values({ id: T, slug: 'a', status: 'active', deploymentMode: 'shared', tier: 'free', maxUsers: 5, appliedCmdSeq: 0, appliedCredSeq: 0, createdAt: new Date() });
    testD1.use(testDb);
    svc = new RecommendationService(testD1.binding);
  });

  it('persists and returns recommendedContractorTypeId on create + update', async () => {
    const rec = await svc.create(T, { name: 'Fix panel', severity: 'significant', defaultRepairSummary: 'Replace breaker', recommendedContractorTypeId: 'ct-electrician' });
    expect(rec.recommendedContractorTypeId).toBe('ct-electrician');

    const stored = await testDb.select().from(schema.comments).where(eq(schema.comments.id, rec.id)).get();
    expect(stored?.recommendedContractorTypeId).toBe('ct-electrician');

    const updated = await svc.update(rec.id, T, { recommendedContractorTypeId: null });
    expect(updated.recommendedContractorTypeId).toBeNull();
  });
});
