import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { lazyD1 } from '../helpers/d1-binding';
const testD1 = lazyD1();
import { PeopleService } from '../../../server/services/people.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';

// Spec 3 flips capabilitiesForKind('agent').selfRetrieveReport to true
// (server/lib/people/capabilities.ts). Every consumer of
// roleKeysWithCapability is data-driven (Spec 1), so seeding a tenant's
// default role profiles and asking for the 'selfRetrieveReport' capability
// must now include the agent-kind keys (buyer_agent, listing_agent)
// alongside the client-kind keys (client, co_client).
describe('roleKeysWithCapability(selfRetrieveReport) — agent flip opens agent-kind keys', () => {
  let svc: PeopleService; let db: any;

  beforeEach(async () => {
    const f = createTestDb(); db = f.db; await setupSchema(f.sqlite);
    await seedRoleProfiles(db, 't1', new Date(1));
    await db.insert(schema.tenants).values([
      { id: 't1', slug: 't1', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(1) },
    ]);
    testD1.use(db);
    svc = new PeopleService({ DB: testD1.binding });
  });

  it('includes client, co_client, buyer_agent, and listing_agent', async () => {
    const keys = await svc.roleKeysWithCapability('t1', 'selfRetrieveReport');
    expect(keys.sort()).toEqual(['buyer_agent', 'client', 'co_client', 'listing_agent']);
  });
});
