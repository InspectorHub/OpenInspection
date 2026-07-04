import { describe, it, expect, beforeEach } from 'vitest';
import { applyResultsBatch } from '../../../server/services/inspection-results.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

const T1 = '00000000-0000-0000-0000-000000000001';
const T2 = '00000000-0000-0000-0000-000000000002';

describe('applyResultsBatch tenant scoping', () => {
  let db: BetterSQLite3Database<typeof schema>;
  beforeEach(async () => {
    const fix = createTestDb(); db = fix.db; await setupSchema(fix.sqlite);
    for (const t of [T1, T2]) await db.insert(schema.tenants).values({ id: t, name: t, slug: t, status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() });
    await db.insert(schema.inspections).values({ id: 'i-1', tenantId: T1, propertyAddress: 'x', date: '2026-06-01', status: 'requested', paymentStatus: 'unpaid', price: 0, agreementRequired: false, paymentRequired: false, createdAt: new Date() });
  });

  it('does not mutate an inspection owned by another tenant', async () => {
    await applyResultsBatch(db, 'i-1', [{ itemId: 'a', sectionId: 's', field: 'rating', value: 'D' }] as any, { tenantId: T2, userId: 'u' });
    const row = await db.select().from(schema.inspectionResults).where(eq(schema.inspectionResults.inspectionId, 'i-1')).get();
    expect(row).toBeUndefined(); // nothing written for T2's bogus request
  });
});
