import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { ContactService } from '../../../server/services/contact.service';
import { listReferrals } from '../../../server/services/agent/referral';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const T = '11111111-1111-1111-1111-1111111111c1';
const INSP = '99999999-9999-9999-9999-999999999c91';
const BA_PROFILE = '55555555-5555-5555-5555-5555555555c1';
const AGENT_CONTACT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaac1';
const AGENT_USER = 'dddddddd-dddd-dddd-dddd-ddddddddddc1'; // global agent account (tenant_id NULL)

async function seed(db: BetterSQLite3Database<typeof schema>) {
  await db.insert(schema.tenants).values(
    { id: T, slug: 'a', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() });
  await db.insert(schema.users).values(
    { id: AGENT_USER, tenantId: null, email: 'a@x.test', passwordHash: 'x', role: 'agent', createdAt: new Date() });
  await db.insert(schema.contacts).values(
    { id: AGENT_CONTACT, tenantId: T, type: 'agent', name: 'Agent A', email: 'a@x.test', createdAt: new Date() });
  await db.insert(schema.contactRoleProfiles).values(
    { id: BA_PROFILE, tenantId: T, key: 'buyer_agent', label: "Buyer's Agent", kind: 'agent', isSystem: true, sortOrder: 0, active: true, createdAt: new Date(), updatedAt: new Date() });
  await db.insert(schema.inspections).values(
    { id: INSP, tenantId: T, propertyAddress: '1 St', date: '2026-01-01', status: 'completed', price: 0, createdAt: new Date() } as never);
  await db.insert(schema.inspectionPeople).values(
    { id: 'p1', tenantId: T, inspectionId: INSP, contactId: AGENT_CONTACT, roleProfileId: BA_PROFILE, createdAt: new Date() });
  // IA-104 — the binding is a column on the buyer_agent contact itself.
  await db.update(schema.contacts)
    .set({ agentUserId: AGENT_USER, agentLinkedAt: new Date() })
    .where(eq(schema.contacts.id, AGENT_CONTACT));
}

describe('archive is not revoke', () => {
  let db: BetterSQLite3Database<typeof schema>;
  beforeEach(async () => {
    const fix = createTestDb();
    db = fix.db;
    await setupSchema(fix.sqlite);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockDrizzle as any).mockReturnValue(db);
    await seed(db);
  });

  it('the agent still sees the referral after the contact is archived', async () => {
    const before = await listReferrals({} as D1Database, AGENT_USER, { limit: 50 });
    expect(before.map((r) => r.id)).toContain(INSP);

    await new ContactService({} as D1Database).deleteContact(AGENT_CONTACT, T); // archives (referenced)
    const contact = await db.select().from(schema.contacts).where(eq(schema.contacts.id, AGENT_CONTACT)).get();
    expect(contact?.archivedAt).toBeTruthy(); // confirm it archived, not hard-deleted

    const after = await listReferrals({} as D1Database, AGENT_USER, { limit: 50 });
    expect(after.map((r) => r.id)).toContain(INSP); // still visible — archive did not revoke access
  });

  it('revoking the binding DOES remove it', async () => {
    // The counterpart to the case above. Archiving retires the contact from
    // the workspace list; revoking is the deliberate act that withdraws the
    // agent's access, and only it should have that effect.
    await db.update(schema.contacts)
      .set({ agentRevokedAt: new Date() })
      .where(eq(schema.contacts.id, AGENT_CONTACT));

    const after = await listReferrals({} as D1Database, AGENT_USER, { limit: 50 });
    expect(after.map((r) => r.id)).not.toContain(INSP);
  });

  it('has no stale-pointer case left to rescue', async () => {
    // A second scenario used to live here purely to exercise an email-matching
    // fallback, which existed because agent_tenant_links held a pointer to a
    // contact and that pointer was never updated. IA-104 put the binding ON
    // the contact, so the association and the row it describes are the same
    // record — there is nothing that can drift out of agreement, and nothing
    // for a fallback to catch.
    const bound = await db.select().from(schema.contacts)
      .where(eq(schema.contacts.id, AGENT_CONTACT)).get();
    expect(bound?.agentUserId).toBe(AGENT_USER);
    expect(Object.keys(bound ?? {})).not.toContain('inspectorContactId');
  });
});
