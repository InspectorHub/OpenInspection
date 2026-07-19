import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { PeopleService } from '../../../server/services/people.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';

const rp = (key: string) => `crp_t1_${key}`;

describe('PeopleService', () => {
  let svc: PeopleService; let db: any;
  beforeEach(async () => {
    const f = createTestDb(); db = f.db; await setupSchema(f.sqlite);
    await seedRoleProfiles(db, 't1', new Date(1));
    await db.insert(schema.tenants).values([
      { id: 't1', name: 'T1', slug: 't1', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(1) },
    ]);
    await db.insert(schema.contacts).values([
      { id: 'c1', tenantId: 't1', type: 'client', name: 'Buyer One', email: 'b1@x.com', phone: '111', createdAt: new Date(1) },
      { id: 'c2', tenantId: 't1', type: 'client', name: 'Buyer Two', email: 'b2@x.com', phone: '222', createdAt: new Date(1) },
    ]);
    (mockDrizzle as any).mockReturnValue(db);
    svc = new PeopleService({} as any);
  });

  it('adds a primary client and resolves it', async () => {
    await svc.addPerson('t1', 'i1', 'c1', rp('client'));
    const pc = await svc.getPrimaryClient('t1', 'i1');
    expect(pc).toMatchObject({ contactId: 'c1', email: 'b1@x.com' });
  });

  it('rejects a second primary client, but allows co_client', async () => {
    await svc.addPerson('t1', 'i1', 'c1', rp('client'));
    await expect(svc.addPerson('t1', 'i1', 'c2', rp('client'))).rejects.toThrow();
    await svc.addPerson('t1', 'i1', 'c2', rp('co_client')); // ok
    const people = await svc.listPeople('t1', 'i1');
    expect(people.map(p => p.roleKey).sort()).toEqual(['client', 'co_client']);
  });

  it('roleKeysWithCapability(selfRetrieveReport) = client + co_client + agent-kind keys (Spec 3 flip)', async () => {
    const keys = await svc.roleKeysWithCapability('t1', 'selfRetrieveReport');
    expect(keys.sort()).toEqual(['buyer_agent', 'client', 'co_client', 'listing_agent']);
  });

  it('contactIdForRole resolves the contact id for a given inspection + role key', async () => {
    await svc.addPerson('t1', 'i1', 'c1', rp('buyer_agent'));
    const id = await svc.contactIdForRole('t1', 'i1', 'buyer_agent');
    expect(id).toBe('c1');
  });

  it('contactIdForRole returns null when no person has that role on the inspection', async () => {
    const id = await svc.contactIdForRole('t1', 'i1', 'buyer_agent');
    expect(id).toBeNull();
  });

  it('contactIdForRole is tenant-scoped — a same-inspectionId row in another tenant does not leak', async () => {
    await seedRoleProfiles(db, 't2', new Date(1));
    await db.insert(schema.tenants).values({ id: 't2', name: 'T2', slug: 't2', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(1) });
    await db.insert(schema.contacts).values({ id: 'c3', tenantId: 't2', type: 'agent', name: 'Other Agent', email: 'o@x.com', createdAt: new Date(1) });
    await svc.addPerson('t2', 'i1', 'c3', `crp_t2_buyer_agent`);
    const id = await svc.contactIdForRole('t1', 'i1', 'buyer_agent');
    expect(id).toBeNull();
  });
});
