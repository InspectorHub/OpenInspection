/**
 * IA-100 — a report link is a per-inspection token addressed to an email. It
 * works with no account, so it survives the contact row being archived, and
 * nothing on the contacts page ever showed it. Archiving therefore LOOKED like
 * it cut someone off and did not.
 *
 * These pin the three things that fixes:
 *   1. you can see what a contact can still open,
 *   2. you can withdraw it, individually or in bulk,
 *   3. archiving withdraws it only when the tenant said so.
 *
 * Type-agnostic throughout: clients hold these links exactly as agents do, and
 * an operator revoking access after a sale falls through cares about the
 * person, not their contact type.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { ContactService } from '../../../server/services/contact.service';
import { PortalAccessService } from '../../../server/services/portal-access.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const T = '11111111-1111-1111-1111-111111111111';
const CONTACT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const EMAIL = 'dana@realty.test';

async function seed(db: BetterSQLite3Database<typeof schema>) {
  await db.insert(schema.tenants).values({
    id: T, name: 'Acme', slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
  });
  await db.insert(schema.contacts).values({
    id: CONTACT, tenantId: T, type: 'client', name: 'Dana', email: EMAIL, createdAt: new Date(),
  });
  await db.insert(schema.inspections).values([
    { id: 'i1', tenantId: T, propertyAddress: '1 Main', date: '2026-01-01', status: 'completed', price: 0, createdAt: new Date() },
    { id: 'i2', tenantId: T, propertyAddress: '2 Oak', date: '2026-02-01', status: 'completed', price: 0, createdAt: new Date() },
    { id: 'i3', tenantId: T, propertyAddress: '3 Elm', date: '2026-03-01', status: 'completed', price: 0, createdAt: new Date() },
  ] as never);

  const tok = (id: string, inspectionId: string, extra: Record<string, unknown> = {}) => ({
    id, tenantId: T, inspectionId, recipientEmail: EMAIL, role: 'client',
    token: 'tok-' + id, createdAt: new Date(), ...extra,
  });
  await db.insert(schema.inspectionAccessTokens).values([
    tok('t1', 'i1'),
    tok('t2', 'i2', { expiresAt: new Date(Date.now() + 86_400_000) }), // live, expires tomorrow
    tok('t3', 'i3', { revokedAt: new Date() }),                        // already revoked
  ] as never);
}

describe('contact access (IA-100)', () => {
  let db: BetterSQLite3Database<typeof schema>;
  let svc: ContactService;

  beforeEach(async () => {
    const fix = createTestDb();
    db = fix.db;
    await setupSchema(fix.sqlite);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockDrizzle as any).mockReturnValue(db);
    await seed(db);
    svc = new ContactService({} as D1Database, new PortalAccessService({} as D1Database));
  });

  it('lists what the contact can still open, and nothing else', async () => {
    const access = await svc.listAccess(CONTACT, T);
    const ids = (access ?? []).map((a) => a.inspectionId).sort();

    // t3 is revoked and must not appear. t2 has a FUTURE expiry and must.
    expect(ids).toEqual(['i1', 'i2']);
    expect(access?.find((a) => a.inspectionId === 'i1')?.propertyAddress).toBe('1 Main');
  });

  it('counts a null expiry as live, not as expired', async () => {
    // The dangerous direction for a screen answering "who can still read this"
    // is under-reporting. A null expiry means open-by-policy, not lapsed.
    const access = await svc.listAccess(CONTACT, T);
    expect(access?.some((a) => a.inspectionId === 'i1')).toBe(true);
  });

  it('revokes only the inspections named', async () => {
    const n = await svc.revokeAccess(CONTACT, T, ['i1']);
    expect(n).toBe(1);

    const left = (await svc.listAccess(CONTACT, T))?.map((a) => a.inspectionId);
    expect(left).toEqual(['i2']);
  });

  it('revokes everything when no ids are given', async () => {
    const n = await svc.revokeAccess(CONTACT, T);
    expect(n).toBe(2); // i1 + i2; i3 was already revoked and is not re-counted

    expect(await svc.listAccess(CONTACT, T)).toEqual([]);
  });

  it('reports what it actually revoked, not what was asked for', async () => {
    // i3 is already dead. Counting it would teach an operator to trust a
    // number that is not measuring anything.
    const n = await svc.revokeAccess(CONTACT, T, ['i1', 'i3']);
    expect(n).toBe(1);
  });

  it('distinguishes an unknown contact from one with no access', async () => {
    // Both would render as "nothing to see" but mean very different things,
    // so the route needs to be able to 404 rather than show an empty list.
    expect(await svc.listAccess('99999999-9999-9999-9999-999999999999', T)).toBeNull();
    expect(await svc.revokeAccess('99999999-9999-9999-9999-999999999999', T)).toBeNull();
  });

  it('will not reach across tenants', async () => {
    expect(await svc.listAccess(CONTACT, '22222222-2222-2222-2222-222222222222')).toBeNull();
  });

  describe('archiving', () => {
    async function archive() {
      // A referenced contact soft-archives; deleteContact hard-deletes only
      // when nothing points at it, so give it an inspection_people row.
      await db.insert(schema.contactRoleProfiles).values({
        id: 'rp1', tenantId: T, key: 'client', label: 'Client', kind: 'client',
        isSystem: true, sortOrder: 0, active: true, createdAt: new Date(), updatedAt: new Date(),
      });
      await db.insert(schema.inspectionPeople).values({
        id: 'p1', tenantId: T, inspectionId: 'i1', contactId: CONTACT, roleProfileId: 'rp1', createdAt: new Date(),
      });
      await svc.deleteContact(CONTACT, T);
    }

    it('leaves access intact by default', async () => {
      // Archiving is list hygiene, not offboarding. A buyer's agent whose deal
      // closed should not lose the report they were legitimately given.
      await db.insert(schema.tenantConfigs).values({ tenantId: T, updatedAt: new Date() } as never);
      await archive();

      const contact = await db.select().from(schema.contacts).where(eq(schema.contacts.id, CONTACT)).get();
      expect(contact?.archivedAt).toBeTruthy();
      expect((await svc.listAccess(CONTACT, T))?.length).toBe(2);
    });

    it('revokes everything when the tenant opted in', async () => {
      await db.insert(schema.tenantConfigs).values({ tenantId: T, archiveRevokesAccess: true, updatedAt: new Date() } as never);
      await archive();

      expect(await svc.listAccess(CONTACT, T)).toEqual([]);
    });
  });
});
