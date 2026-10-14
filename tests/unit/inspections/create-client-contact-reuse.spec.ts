/**
 * A create that names its own inspection id and its client by flat fields resolves the client to a
 * contact by e-mail. The unique index on contacts is (tenant, e-mail) for live rows and does not look
 * at the type, so a broker who is also a client already owns that address. The create must reuse that
 * contact (one person, a different role on each inspection) instead of colliding with the index, and
 * a replay of the same id must give the same answer. A replay that arrives with a different body
 * only completes what the first attempt left out.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { and, eq, count } from 'drizzle-orm';
import { app } from '../../../server/index';
import { makeExecutionContext } from '../helpers/exec-ctx';
import * as schema from '../../../server/lib/db/schema';
import { buildKeyring, signJwt } from '../../../server/lib/jwt-keyring';
import { softUpsertClientContact } from '../../../server/services/inspection/create-client-contact';
import { asD1DrizzleReturn } from '../helpers/test-db';
import { createHarness, INSPECTOR_ID, TENANT_ID, type Harness } from '../helpers/tenant-email-harness';

const TEMPLATE_ID = 'tpl-reuse';
const INSPECTION_ID = '55555555-0000-4000-8000-000000000001';
const SECOND_ID = '55555555-0000-4000-8000-000000000002';
const BROKER_ID = 'contact-broker';
const AGENT_B_ID = 'contact-agent-b';

describe('flat client fields on a client-chosen id resolve to a contact by e-mail', () => {
  let h: Harness | undefined;
  afterEach(() => { h?.close(); h = undefined; });

  async function seed(): Promise<Harness> {
    const created = await createHarness('saas');
    await created.db.insert(schema.templates).values({
      id: TEMPLATE_ID, tenantId: TENANT_ID, name: 'Standard', schema: { sections: [] }, version: 1, createdAt: new Date(),
    } as typeof schema.templates.$inferInsert);
    return created;
  }

  async function post(body: unknown): Promise<Response> {
    const keyring = await buildKeyring(h!.env as unknown as Record<string, string | undefined>);
    const now = Math.floor(Date.now() / 1000);
    const jwt = await signJwt({
      sub: INSPECTOR_ID, role: 'inspector', 'custom:userRole': 'inspector', 'custom:tenantId': TENANT_ID, iat: now, exp: now + 3600,
    }, keyring);
    const exec = makeExecutionContext({ label: 'create-client-contact-reuse' });
    const res = await app.request('/api/inspections', {
      method: 'POST',
      headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }, h!.env, exec.ctx);
    await exec.settle();
    return res;
  }

  const flat = (id: string, extra: object = {}) => ({
    propertyAddress: '1 Reuse Way', templateId: TEMPLATE_ID, id, ...extra,
  });

  async function contactCount(): Promise<number> {
    return (await h!.db.select({ n: count() }).from(schema.contacts).get())?.n ?? 0;
  }

  async function people(id: string) {
    return h!.db.select({ role: schema.contactRoleProfiles.key, contactId: schema.inspectionPeople.contactId })
      .from(schema.inspectionPeople)
      .innerJoin(schema.contactRoleProfiles, eq(schema.contactRoleProfiles.id, schema.inspectionPeople.roleProfileId))
      .where(eq(schema.inspectionPeople.inspectionId, id)).all();
  }

  async function seedBroker(): Promise<void> {
    await h!.db.insert(schema.contacts).values({
      id: BROKER_ID, tenantId: TENANT_ID, type: 'agent', name: 'Bo Broker', email: 'bo@agency.test', createdAt: new Date(),
    });
  }

  it('links the client to the existing agent contact with the same e-mail, without a duplicate', async () => {
    h = await seed();
    await seedBroker();
    const res = await post(flat(INSPECTION_ID, { clientName: 'Bo Broker', clientEmail: 'bo@agency.test' }));
    expect(res.status, await res.clone().text()).toBe(201);
    expect(await contactCount()).toBe(1);
    expect(await people(INSPECTION_ID)).toEqual([{ role: 'client', contactId: BROKER_ID }]);
  });

  it('matches the e-mail without regard to case', async () => {
    h = await seed();
    await seedBroker();
    const res = await post(flat(INSPECTION_ID, { clientName: 'Bo Broker', clientEmail: 'Bo@Agency.TEST' }));
    expect(res.status, await res.clone().text()).toBe(201);
    expect(await contactCount()).toBe(1);
    expect(await people(INSPECTION_ID)).toEqual([{ role: 'client', contactId: BROKER_ID }]);
  });

  it('control: an address nobody owns creates a new client contact, stored in lower case', async () => {
    h = await seed();
    await seedBroker();
    const res = await post(flat(INSPECTION_ID, { clientName: 'New Client', clientEmail: 'New@Client.test' }));
    expect(res.status, await res.clone().text()).toBe(201);
    expect(await contactCount()).toBe(2);
    const created = await h.db.select().from(schema.contacts).where(eq(schema.contacts.name, 'New Client')).get();
    expect(created?.type).toBe('client');
    expect(created?.email).toBe('new@client.test');
    expect(await people(INSPECTION_ID)).toEqual([{ role: 'client', contactId: created?.id }]);
  });

  it('an archived contact with the address does not capture the client', async () => {
    h = await seed();
    await h.db.insert(schema.contacts).values({
      id: BROKER_ID, tenantId: TENANT_ID, type: 'agent', name: 'Old', email: 'bo@agency.test', createdAt: new Date(), archivedAt: new Date(),
    });
    const res = await post(flat(INSPECTION_ID, { clientName: 'Bo Broker', clientEmail: 'bo@agency.test' }));
    expect(res.status, await res.clone().text()).toBe(201);
    const links = await people(INSPECTION_ID);
    expect(links).toHaveLength(1);
    expect(links[0]?.contactId).not.toBe(BROKER_ID);
  });

  it('a client with a name and no e-mail still matches a client contact by name (unchanged)', async () => {
    h = await seed();
    expect((await post(flat(INSPECTION_ID, { clientName: 'Just A Name' }))).status).toBe(201);
    expect((await post(flat(SECOND_ID, { clientName: 'Just A Name' }))).status).toBe(201);
    expect(await contactCount()).toBe(1);
  });

  it('a contact that takes the address between the look-up and the insert is reused, not a failure', async () => {
    h = await seed();
    await seedBroker();
    const real = asD1DrizzleReturn(h.db);
    // The first look-up is blind, as it is when the other writer commits just after it: the address
    // is already taken by the time the insert runs, and the index refuses it.
    let blind = true;
    const staleFirstRead = new Proxy(real, {
      get(target, prop, receiver) {
        if (prop === 'select' && blind) {
          blind = false;
          return () => ({ from: () => ({ where: () => ({ get: async () => undefined }) }) });
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    const id = await softUpsertClientContact(
      staleFirstRead, TENANT_ID,
      { name: 'Bo Broker', email: 'Bo@Agency.test', phone: null, createdAt: new Date() },
      null, INSPECTION_ID, { rethrow: true },
    );
    expect(blind, 'the stale read was used').toBe(false);
    expect(id).toBe(BROKER_ID);
    expect(await contactCount()).toBe(1);
    // Control: with no rival the same call creates the client.
    const fresh = await softUpsertClientContact(
      real, TENANT_ID, { name: 'Zed', email: 'zed@agency.test', phone: null, createdAt: new Date() }, null, INSPECTION_ID, { rethrow: true },
    );
    expect(fresh).not.toBe(BROKER_ID);
    expect(await contactCount()).toBe(2);
  });

  it('a replay finds the same contact and writes nothing more', async () => {
    h = await seed();
    await seedBroker();
    const body = flat(INSPECTION_ID, { clientName: 'Bo Broker', clientEmail: 'bo@agency.test' });
    expect((await post(body)).status).toBe(201);
    expect((await post(body)).status).toBe(200);
    expect(await contactCount()).toBe(1);
    expect(await people(INSPECTION_ID)).toEqual([{ role: 'client', contactId: BROKER_ID }]);
  });
});

describe('a replay with a different body only fills what the first attempt left out', () => {
  let h: Harness | undefined;
  afterEach(() => { h?.close(); h = undefined; });

  async function post(body: unknown): Promise<Response> {
    const keyring = await buildKeyring(h!.env as unknown as Record<string, string | undefined>);
    const now = Math.floor(Date.now() / 1000);
    const jwt = await signJwt({
      sub: INSPECTOR_ID, role: 'inspector', 'custom:userRole': 'inspector', 'custom:tenantId': TENANT_ID, iat: now, exp: now + 3600,
    }, keyring);
    const exec = makeExecutionContext({ label: 'create-replay-people' });
    const res = await app.request('/api/inspections', {
      method: 'POST',
      headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }, h!.env, exec.ctx);
    await exec.settle();
    return res;
  }

  async function peopleOf(id: string) {
    return h!.db.select({ role: schema.contactRoleProfiles.key, name: schema.contacts.name })
      .from(schema.inspectionPeople)
      .innerJoin(schema.contactRoleProfiles, eq(schema.contactRoleProfiles.id, schema.inspectionPeople.roleProfileId))
      .innerJoin(schema.contacts, eq(schema.contacts.id, schema.inspectionPeople.contactId))
      .where(and(eq(schema.inspectionPeople.inspectionId, id), eq(schema.inspectionPeople.tenantId, TENANT_ID))).all();
  }

  it('keeps the first client as primary and still adds the agent the first attempt never reached', async () => {
    h = await createHarness('saas');
    await h.db.insert(schema.templates).values({
      id: TEMPLATE_ID, tenantId: TENANT_ID, name: 'Standard', schema: { sections: [] }, version: 1, createdAt: new Date(),
    } as typeof schema.templates.$inferInsert);
    await h.db.insert(schema.contacts).values({
      id: AGENT_B_ID, tenantId: TENANT_ID, type: 'agent', name: 'Agent B', email: 'b@agency.test', createdAt: new Date(),
    });
    const base = { propertyAddress: '2 Replay Way', templateId: TEMPLATE_ID, id: INSPECTION_ID };

    // The first attempt links client A and dies on the next person (the agent), so no report exists.
    h.sqlite.exec(`CREATE TRIGGER fail_agent BEFORE INSERT ON inspection_people
      WHEN NEW.role_profile_id IN (SELECT id FROM contact_role_profiles WHERE key = 'buyer_agent')
      BEGIN SELECT RAISE(ABORT, 'injected failure'); END`);
    const first = await post({ ...base, clientName: 'Client A', clientEmail: 'a@client.test', referredByAgentId: AGENT_B_ID });
    expect(first.status).toBeGreaterThanOrEqual(500);
    h.sqlite.exec('DROP TRIGGER fail_agent');
    expect(await peopleOf(INSPECTION_ID)).toEqual([{ role: 'client', name: 'Client A' }]);

    // The replay names a different client; A stays primary and nobody is handed over.
    const replay = await post({ ...base, clientName: 'Client Z', clientEmail: 'z@client.test', referredByAgentId: AGENT_B_ID });
    expect(replay.status, await replay.clone().text()).toBe(200);
    const after = await peopleOf(INSPECTION_ID);
    expect(after.map((p) => `${p.role}:${p.name}`).sort()).toEqual(['buyer_agent:Agent B', 'client:Client A']);
  });
});
