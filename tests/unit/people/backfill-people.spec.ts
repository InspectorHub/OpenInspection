import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import { backfillInspectionPeople } from '../../../server/services/seed/backfill-people';
import { eq } from 'drizzle-orm';

/**
 * Task 13 (DESTRUCTIVE) — backfillInspectionPeople reads the legacy
 * clientContactId/clientEmail/referredByAgentId/sellingAgentId columns off
 * `inspections` via the Drizzle-typed schema object. Now that those columns
 * are DROPPED from the schema (and the table), the Drizzle select never
 * surfaces them regardless of what a remote row physically still holds — the
 * function degrades to a permanent no-op in code built at or after this
 * commit.
 *
 * This is expected, not a regression: the deploy runbook requires operators
 * to run this backfill against each pre-existing-tenant environment BEFORE
 * this commit's migration reaches it (checked out at the ref just before
 * Task 13 — see .superpowers/sdd/progress.md Task 13 entry), while the
 * columns still exist there. Once that has run, the source data has already
 * been copied into inspection_people and this utility has nothing left to do.
 */
describe('backfillInspectionPeople (Task 13 — retired: reads dropped columns, now a no-op)', () => {
  let f: ReturnType<typeof createTestDb>;
  beforeEach(async () => {
    f = createTestDb(); await setupSchema(f.sqlite);
    await f.db.insert(schema.tenants).values({ id: 't1', name: 'T', slug: 't1', createdAt: new Date(1) } as any);
    await seedRoleProfiles(f.db as any, 't1', new Date(1));
    await f.db.insert(schema.contacts).values([
      { id: 'client1', tenantId: 't1', type: 'client', name: 'Buyer', email: 'b@x.com', createdAt: new Date(1) },
      { id: 'agentB',  tenantId: 't1', type: 'agent',  name: 'BuyerAgent', email: 'ba@x.com', createdAt: new Date(1) },
      { id: 'agentL',  tenantId: 't1', type: 'agent',  name: 'ListAgent',  email: 'la@x.com', createdAt: new Date(1) },
    ]);
    await f.db.insert(schema.inspections).values({
      id: 'i1', tenantId: 't1', propertyAddress: '1 Main', date: '2026-06-01', status: 'confirmed',
      paymentStatus: 'paid', price: 0, createdAt: new Date(1),
    } as any);
  });

  it('is a permanent no-op now that the source columns are dropped', async () => {
    const r1 = await backfillInspectionPeople(f.db as any, 't1');
    const rows = await f.db.select().from(schema.inspectionPeople).where(eq(schema.inspectionPeople.inspectionId, 'i1'));
    expect(rows).toHaveLength(0);
    expect(r1.created).toBe(0);
  });
});
