import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import { backfillInspectionPeople } from '../../../server/services/seed/backfill-people';
import { eq } from 'drizzle-orm';

describe('backfillInspectionPeople', () => {
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
    // inspection row with the OLD people columns still present
    await f.db.insert(schema.inspections).values({
      id: 'i1', tenantId: 't1', propertyAddress: '1 Main', date: '2026-06-01', status: 'confirmed',
      paymentStatus: 'paid', price: 0, createdAt: new Date(1),
      clientContactId: 'client1', clientName: 'Buyer', clientEmail: 'b@x.com',
      referredByAgentId: 'agentB', sellingAgentId: 'agentL',
    } as any);
  });

  it('creates client + buyer_agent + listing_agent people, idempotently', async () => {
    const r1 = await backfillInspectionPeople(f.db as any, 't1');
    const r2 = await backfillInspectionPeople(f.db as any, 't1'); // idempotent
    const rows = await f.db.select().from(schema.inspectionPeople).where(eq(schema.inspectionPeople.inspectionId, 'i1'));
    expect(rows).toHaveLength(3);
    expect(r2.created).toBe(0);
    expect(r1.created).toBe(3);
  });
});
