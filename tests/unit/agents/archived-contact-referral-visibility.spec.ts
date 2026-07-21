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
const LINK = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeec1';

async function seed(db: BetterSQLite3Database<typeof schema>) {
  await db.insert(schema.tenants).values(
    { id: T, name: 'A', slug: 'a', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() });
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
  // Active link scoped to this agent + tenant, pointing at the buyer_agent contact.
  await db.insert(schema.agentTenantLinks).values(
    { id: LINK, tenantId: T, agentUserId: AGENT_USER, inspectorContactId: AGENT_CONTACT, status: 'active', createdAt: new Date() } as never);
}

describe('archive preserves agent referral visibility (②)', () => {
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
});

// getAgentReferralFilter (server/services/agent/referral.ts) matches a referral
// via EITHER of two independent paths:
//   1. canonical link: inspectionPeople.contactId === agentTenantLinks.inspectorContactId
//      — never touches the `contacts` table at all.
//   2. email fallback: contacts.email (joined off inspectionPeople.contactId)
//      === the agent user's email — THIS is the path that reads through the
//      `contacts` leftJoin and would silently break if that join ever grew an
//      `isNull(contacts.archivedAt)` filter.
// The scenario above only exercises path 1 (inspectorContactId is set to the
// buyer_agent contact), so it can't catch a regression on path 2. This second
// scenario deliberately breaks path 1 (inspectorContactId left NULL) so the
// ONLY way the referral is found is via the email-fallback contacts join —
// making it possible for that join to accidentally hide the archived row.
const T2 = '22222222-2222-2222-2222-2222222222c2';
const INSP2 = '99999999-9999-9999-9999-999999999c92';
const BA_PROFILE2 = '55555555-5555-5555-5555-5555555555c2';
const AGENT_CONTACT2 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaac2';
const AGENT_USER2 = 'dddddddd-dddd-dddd-dddd-ddddddddddc2';
const LINK2 = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeec2';

async function seedEmailFallbackOnly(db: BetterSQLite3Database<typeof schema>) {
  await db.insert(schema.tenants).values(
    { id: T2, name: 'B', slug: 'b', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() });
  // Agent user's email intentionally matches the contact's email below — the
  // ONLY thing that can associate this referral, since the link's
  // inspectorContactId is left NULL (canonical path is unreachable).
  await db.insert(schema.users).values(
    { id: AGENT_USER2, tenantId: null, email: 'b@x.test', passwordHash: 'x', role: 'agent', createdAt: new Date() });
  await db.insert(schema.contacts).values(
    { id: AGENT_CONTACT2, tenantId: T2, type: 'agent', name: 'Agent B', email: 'b@x.test', createdAt: new Date() });
  await db.insert(schema.contactRoleProfiles).values(
    { id: BA_PROFILE2, tenantId: T2, key: 'buyer_agent', label: "Buyer's Agent", kind: 'agent', isSystem: true, sortOrder: 0, active: true, createdAt: new Date(), updatedAt: new Date() });
  await db.insert(schema.inspections).values(
    { id: INSP2, tenantId: T2, propertyAddress: '2 St', date: '2026-01-02', status: 'completed', price: 0, createdAt: new Date() } as never);
  await db.insert(schema.inspectionPeople).values(
    { id: 'p2', tenantId: T2, inspectionId: INSP2, contactId: AGENT_CONTACT2, roleProfileId: BA_PROFILE2, createdAt: new Date() });
  // Active link (so the inner join on agentTenantLinks still includes this
  // tenant), but inspectorContactId is NULL — the canonical match path can
  // never fire, so listReferrals can ONLY find this row via the email
  // fallback (contacts.email === agent's email).
  await db.insert(schema.agentTenantLinks).values(
    { id: LINK2, tenantId: T2, agentUserId: AGENT_USER2, inspectorContactId: null, status: 'active', createdAt: new Date() } as never);
}

describe('archive preserves agent referral visibility via the email-fallback path', () => {
  let db: BetterSQLite3Database<typeof schema>;
  beforeEach(async () => {
    const fix = createTestDb();
    db = fix.db;
    await setupSchema(fix.sqlite);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockDrizzle as any).mockReturnValue(db);
    await seedEmailFallbackOnly(db);
  });

  it('the agent still sees the referral after the contact is archived (email-fallback only)', async () => {
    const before = await listReferrals({} as D1Database, AGENT_USER2, { limit: 50 });
    expect(before.map((r) => r.id)).toContain(INSP2); // reachable ONLY via email fallback (no canonical link)

    await new ContactService({} as D1Database).deleteContact(AGENT_CONTACT2, T2); // archives (referenced)
    const contact = await db.select().from(schema.contacts).where(eq(schema.contacts.id, AGENT_CONTACT2)).get();
    expect(contact?.archivedAt).toBeTruthy(); // confirm it archived, not hard-deleted

    const after = await listReferrals({} as D1Database, AGENT_USER2, { limit: 50 });
    expect(after.map((r) => r.id)).toContain(INSP2); // still visible via email fallback — archive did not revoke access
  });
});
