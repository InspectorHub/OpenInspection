import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { ContactService } from '../../../server/services/contact.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const T = '11111111-1111-1111-1111-1111111111f1';
const INSP = '99999999-9999-9999-9999-999999999991';
const BA_PROFILE = '55555555-5555-5555-5555-555555555551';   // buyer_agent role profile
const AGENT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaf1';         // buyer_agent on INSP (a referral)
const AGENT_ZERO = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaf2';    // on no inspection
const CLIENT = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbf1';

async function seed(db: BetterSQLite3Database<typeof schema>) {
  await db.insert(schema.tenants).values(
    { id: T, name: 'A', slug: 'a', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() });
  await db.insert(schema.contacts).values([
    { id: AGENT,      tenantId: T, type: 'agent',  name: 'Agent A',  email: 'a@x.test', createdAt: new Date() },
    { id: AGENT_ZERO, tenantId: T, type: 'agent',  name: 'Agent Z',  email: 'z@x.test', createdAt: new Date() },
    { id: CLIENT,     tenantId: T, type: 'client', name: 'Client C', email: 'c@x.test', createdAt: new Date() },
  ]);
  // Tenant's buyer_agent role profile — referral attribution keys off this
  // (inspection_people has NO `role` column; the role is via role_profile_id).
  await db.insert(schema.contactRoleProfiles).values(
    { id: BA_PROFILE, tenantId: T, key: 'buyer_agent', label: "Buyer's Agent", kind: 'agent', isSystem: true, sortOrder: 0, active: true, createdAt: new Date(), updatedAt: new Date() });
  await db.insert(schema.inspections).values(
    { id: INSP, tenantId: T, propertyAddress: '1 St', date: '2026-01-01', status: 'completed', price: 0, createdAt: new Date() } as never);
  // AGENT is the buyer_agent on INSP — a real referral link we can prove
  // archive does not orphan.
  await db.insert(schema.inspectionPeople).values(
    { id: 'p1', tenantId: T, inspectionId: INSP, contactId: AGENT, roleProfileId: BA_PROFILE, createdAt: new Date() });
}

describe('ContactService archive + agent-email immutability', () => {
  let db: BetterSQLite3Database<typeof schema>;
  let svc: ContactService;
  beforeEach(async () => {
    const fix = createTestDb();
    db = fix.db;
    await setupSchema(fix.sqlite);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockDrizzle as any).mockReturnValue(db);
    await seed(db);
    svc = new ContactService({} as D1Database);
  });

  it('deleteContact soft-archives a REFERENCED contact (row kept, archived_at set)', async () => {
    await svc.deleteContact(AGENT, T);   // AGENT is on INSP
    const row = await db.select().from(schema.contacts).where(eq(schema.contacts.id, AGENT)).get();
    expect(row).toBeTruthy();
    expect(row?.archivedAt).toBeTruthy();
  });

  it('deleteContact HARD-deletes an UNREFERENCED contact (⑤)', async () => {
    await svc.deleteContact(AGENT_ZERO, T);   // on no inspection
    const row = await db.select().from(schema.contacts).where(eq(schema.contacts.id, AGENT_ZERO)).get();
    expect(row).toBeUndefined();
  });

  it('archiving does not orphan inspection_people', async () => {
    await svc.deleteContact(AGENT, T);
    const link = await db.select().from(schema.inspectionPeople)
      .where(eq(schema.inspectionPeople.contactId, AGENT)).get();
    expect(link).toBeTruthy();
  });

  it('listContacts excludes archived rows', async () => {
    await svc.deleteContact(AGENT, T);
    const rows = await svc.listContacts(T, { limit: 50, offset: 0 });
    expect(rows.map((r) => r.id)).not.toContain(AGENT);
    expect(rows.map((r) => r.id)).toContain(CLIENT);
  });

  it('listContacts reports referralCount (buyer_agent) distinct from inspectionCount (①)', async () => {
    const rows = await svc.listContacts(T, { type: 'agent', limit: 50, offset: 0 });
    const agent = rows.find((r) => r.id === AGENT)!;
    expect(agent.inspectionCount).toBe(1);
    expect(agent.referralCount).toBe(1);
    const zero = rows.find((r) => r.id === AGENT_ZERO)!;
    expect(zero.referralCount).toBe(0);
  });

  it('updateContact ignores an email change on an agent contact', async () => {
    await svc.updateContact(AGENT, T, { name: 'Agent A2', email: 'hijack@x.test' });
    const row = await db.select().from(schema.contacts).where(eq(schema.contacts.id, AGENT)).get();
    expect(row?.email).toBe('a@x.test');   // frozen
    expect(row?.name).toBe('Agent A2');    // other fields still update
  });

  it('updateContact allows an email change on a client contact', async () => {
    await svc.updateContact(CLIENT, T, { email: 'new@x.test' });
    const row = await db.select().from(schema.contacts).where(eq(schema.contacts.id, CLIENT)).get();
    expect(row?.email).toBe('new@x.test');
  });
});
