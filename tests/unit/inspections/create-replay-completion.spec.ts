/**
 * A create that named its own inspection id and died partway is finished by the
 * retry. The pipeline after the `inspections` row ends with the primary report,
 * so a missing report means the pipeline did not finish and the replay runs it
 * again from its own body. Each case fails the first attempt at a different
 * step (a D1 trigger that aborts the INSERT), retries the same id, and compares
 * what the inspection ended up with against a create that never failed.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { and, eq, count } from 'drizzle-orm';
import { app } from '../../../server/index';
import { makeExecutionContext } from '../helpers/exec-ctx';
import * as schema from '../../../server/lib/db/schema';
import { buildKeyring, signJwt } from '../../../server/lib/jwt-keyring';
import { resolvePrimaryReportId } from '../../../server/lib/inspection/reports';
import { getInspectionRoster } from '../../../server/lib/inspection/roster';
import { canAccessInspectionCollab } from '../../../server/lib/collab/can-access';
import { writeInspectionServiceSnapshots } from '../../../server/lib/inspection/service-snapshot';
import { writeAuditRow } from '../../../server/lib/audit';
import { createHarness, INSPECTOR_ID, TENANT_ID, type Harness } from '../helpers/tenant-email-harness';
import { asD1Db } from '../helpers/test-db';

const OTHER_TENANT_ID = '11111111-0000-4000-8000-0000000000ff';
const CONTROL_ID = '44444444-0000-4000-8000-000000000001';
const TARGET_ID = '44444444-0000-4000-8000-000000000002';
const SVC_A = '00000000-0000-0000-0000-0000000009a1';
const SVC_B = '00000000-0000-0000-0000-0000000009a2';
const TEMPLATE_ID = 'tpl-replay';

const BODY = {
  propertyAddress: '12 Replay Lane, Anytown',
  templateId: TEMPLATE_ID,
  date: '2026-06-01T10:00:00.000Z',
  client: { name: 'Pat Client', email: 'pat@client.test', phone: '555-0100' },
  newAgent: { name: 'Ann Agent', email: 'ann@agency.test' },
  serviceSelections: [{ serviceId: SVC_A, priceOverrideCents: 39900 }, { serviceId: SVC_B }],
};

describe('POST /api/inspections replay completes an interrupted create', () => {
  let h: Harness | undefined;
  afterEach(() => { h?.close(); h = undefined; });

  async function seed(): Promise<Harness> {
    const created = await createHarness('saas');
    // The body carries a per-line price override, which only a caller with `inspectionFees` may send.
    await created.db.update(schema.users).set({ permissionOverrides: { inspectionFees: true } })
      .where(eq(schema.users.id, INSPECTOR_ID));
    await created.db.insert(schema.templates).values({
      id: TEMPLATE_ID, tenantId: TENANT_ID, name: 'Standard', schema: { sections: [] }, version: 1, createdAt: new Date(),
    } as typeof schema.templates.$inferInsert);
    await created.db.insert(schema.services).values([
      { id: SVC_A, tenantId: TENANT_ID, name: 'General', price: 45000, active: true, sortOrder: 0, createdAt: new Date() },
      { id: SVC_B, tenantId: TENANT_ID, name: 'Radon', price: 15000, active: true, sortOrder: 1, createdAt: new Date() },
    ] as never);
    return created;
  }

  async function post(body: unknown): Promise<Response> {
    const keyring = await buildKeyring(h!.env as unknown as Record<string, string | undefined>);
    const now = Math.floor(Date.now() / 1000);
    const jwt = await signJwt({
      sub: INSPECTOR_ID, role: 'inspector', 'custom:userRole': 'inspector', 'custom:tenantId': TENANT_ID, iat: now, exp: now + 3600,
    }, keyring);
    const exec = makeExecutionContext({ label: 'create-replay-completion' });
    const res = await app.request('/api/inspections', {
      method: 'POST',
      headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }, h!.env, exec.ctx);
    await exec.settle();
    return res;
  }

  /** Everything the pipeline writes for one inspection, with ids and timestamps left out. */
  async function shape(id: string) {
    const db = h!.db;
    const people = await db.select({ role: schema.contactRoleProfiles.key, name: schema.contacts.name })
      .from(schema.inspectionPeople)
      .innerJoin(schema.contactRoleProfiles, eq(schema.contactRoleProfiles.id, schema.inspectionPeople.roleProfileId))
      .innerJoin(schema.contacts, eq(schema.contacts.id, schema.inspectionPeople.contactId))
      .where(eq(schema.inspectionPeople.inspectionId, id)).all();
    const lines = await db.select().from(schema.inspectionServices).where(eq(schema.inspectionServices.inspectionId, id)).all();
    const perInspection = (table: 'automation_logs' | 'reports' | 'inspection_results'): number => (
      h!.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE inspection_id = ?`).get(id) as { n: number }
    ).n;
    return {
      people: people.map((p) => `${p.role}:${p.name.replace(/^Flat \d$/, 'Flat')}`).sort(),
      lines: lines.map((l) => `${l.serviceId}:${l.priceOverride ?? 'catalog'}:${l.priceSnapshot}`).sort(),
      automationLogs: perInspection('automation_logs'),
      audits: (h!.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE entity_id = ? AND action = 'inspection.create'").get(id) as { n: number }).n,
      reports: perInspection('reports'),
      results: perInspection('inspection_results'),
    };
  }

  async function contactCount(): Promise<number> {
    return (await h!.db.select({ n: count() }).from(schema.contacts).get())?.n ?? 0;
  }

  async function inspectionQuota(): Promise<number> {
    const rows = await h!.db.select().from(schema.usageCounters).where(and(eq(schema.usageCounters.tenantId, TENANT_ID), eq(schema.usageCounters.metric, 'inspections'))).all();
    return rows[0]?.value ?? 0;
  }

  async function mayEdit(id: string): Promise<boolean> {
    const db = asD1Db(h!.db);
    const roster = await getInspectionRoster(db, TENANT_ID, id);
    return !!(await resolvePrimaryReportId(db, TENANT_ID, id)) && canAccessInspectionCollab(roster, { id: INSPECTOR_ID, role: 'inspector' });
  }

  /**
   * A client named only by flat fields is saved as a contact by the pipeline itself; one sent as a
   * `client` object is saved by the route before the pipeline starts. Each inspection gets its own
   * client, so the contact has to be written again for the one that failed.
   */
  const flatClientBody = (id: string) => ({
    propertyAddress: BODY.propertyAddress, templateId: TEMPLATE_ID, id, serviceSelections: BODY.serviceSelections,
    clientName: `Flat ${id.slice(-1)}`, clientEmail: `flat-${id.slice(-1)}@client.test`,
  });

  const INJECTIONS: Array<{ step: string; table: string; when?: string; body?: (id: string) => object; newContacts?: number }> = [
    { step: 'the automation notices', table: 'automation_logs' },
    { step: 'the client contact', table: 'contacts', body: flatClientBody, newContacts: 1 },
    { step: 'the people links', table: 'inspection_people' },
    { step: 'the service lines', table: 'inspection_services' },
    { step: 'the audit row', table: 'audit_logs', when: "NEW.action = 'inspection.create'" },
    { step: 'the primary report', table: 'reports' },
  ];

  for (const injection of INJECTIONS) {
    it(`finishes a create that failed at ${injection.step}: every step once, nothing doubled`, async () => {
      h = await seed();
      const bodyFor = injection.body ?? ((id: string) => ({ ...BODY, id }));
      const control = await post(bodyFor(CONTROL_ID));
      expect(control.status, await control.clone().text()).toBe(201);
      const expected = await shape(CONTROL_ID);
      // The control has to have something at every step, or a missing step could not show.
      expect(expected.people).toHaveLength(injection.body ? 1 : 2);
      expect(expected.lines).toEqual([`${SVC_A}:39900:45000`, `${SVC_B}:catalog:15000`]);
      expect(expected.automationLogs).toBeGreaterThan(0);
      expect(expected.audits).toBe(1);
      const contactsAfterControl = await contactCount();
      const quotaAfterControl = await inspectionQuota();

      h.sqlite.exec(`CREATE TRIGGER fail_step BEFORE INSERT ON ${injection.table}${injection.when ? ` WHEN ${injection.when}` : ''}
        BEGIN SELECT RAISE(ABORT, 'injected failure'); END`);
      const interrupted = await post(bodyFor(TARGET_ID));
      expect(interrupted.status, 'the injected failure must reach the caller').toBeGreaterThanOrEqual(500);
      expect(await resolvePrimaryReportId(asD1Db(h.db), TENANT_ID, TARGET_ID), 'no report while a step is missing').toBeNull();
      expect(await mayEdit(TARGET_ID)).toBe(false);
      h.sqlite.exec('DROP TRIGGER fail_step');

      const replay = await post(bodyFor(TARGET_ID));
      expect(replay.status, await replay.clone().text()).toBe(200);
      expect(await shape(TARGET_ID)).toEqual(expected);
      expect(await mayEdit(TARGET_ID)).toBe(true);
      const contactsAfterReplay = contactsAfterControl + (injection.newContacts ?? 0);
      expect(await contactCount(), 'the client and the agent each exist once').toBe(contactsAfterReplay);
      expect(await inspectionQuota(), 'one allowance for the inspection however many attempts it took').toBe(quotaAfterControl + 1);

      // Further replays of the finished inspection write nothing.
      for (let i = 0; i < 2; i += 1) {
        const again = await post(bodyFor(TARGET_ID));
        expect(again.status).toBe(200);
      }
      expect(await shape(TARGET_ID)).toEqual(expected);
      expect(await contactCount()).toBe(contactsAfterReplay);
      expect(await inspectionQuota()).toBe(quotaAfterControl + 1);
    });
  }

  it('repeats of a create that never failed add nothing (control)', async () => {
    h = await seed();
    const first = await post({ ...BODY, id: TARGET_ID });
    expect(first.status, await first.clone().text()).toBe(201);
    const whole = await shape(TARGET_ID);
    for (let i = 0; i < 3; i += 1) expect((await post({ ...BODY, id: TARGET_ID })).status).toBe(200);
    expect(await shape(TARGET_ID)).toEqual(whole);
    expect(await inspectionQuota()).toBe(1);
  });

  it('refuses to link a contact from another workspace when completing an interrupted create, and writes nothing', async () => {
    h = await seed();
    await h.db.insert(schema.tenants).values({
      id: OTHER_TENANT_ID, slug: 'other-co', status: 'active', tier: 'free', maxUsers: 5, deploymentMode: 'shared', createdAt: new Date(),
    });
    await h.db.insert(schema.contacts).values({
      id: 'foreign-agent', tenantId: OTHER_TENANT_ID, type: 'agent', name: 'Foreign Agent', email: 'f@other.test', createdAt: new Date(),
    });
    h.sqlite.exec(`CREATE TRIGGER fail_step BEFORE INSERT ON reports BEGIN SELECT RAISE(ABORT, 'injected failure'); END`);
    expect((await post({ ...BODY, id: TARGET_ID })).status).toBeGreaterThanOrEqual(500);
    h.sqlite.exec('DROP TRIGGER fail_step');

    const replay = await post({
      propertyAddress: BODY.propertyAddress, templateId: TEMPLATE_ID, client: BODY.client, id: TARGET_ID, agentContactId: 'foreign-agent',
    });
    expect(replay.status, await replay.clone().text()).toBe(400);
    expect((await shape(TARGET_ID)).people.join(), 'the foreign agent was not linked').not.toContain('Foreign Agent');
    expect(await resolvePrimaryReportId(asD1Db(h.db), TENANT_ID, TARGET_ID)).toBeNull();
    // Control: the same inspection completes from an honest body.
    expect((await post({ ...BODY, id: TARGET_ID })).status).toBe(200);
  });

  // The create and a replay of it can run at once and nothing keeps them apart, so the two writes that a
  // "look first, then insert" cannot protect carry ids derived from the inspection. Both are exercised
  // here directly, the way the second of two overlapping runs would reach them.
  it('writing the service lines a second time leaves the first lines and their prices alone (control: the first write)', async () => {
    h = await seed();
    const db = asD1Db(h.db);
    expect((await post({ ...BODY, id: CONTROL_ID })).status).toBe(201);
    const first = await shape(CONTROL_ID);
    expect(first.lines).toHaveLength(2);
    const second = await writeInspectionServiceSnapshots(db, TENANT_ID, CONTROL_ID, { serviceSelections: [{ serviceId: SVC_A, priceOverrideCents: 100 }, { serviceId: SVC_B }] });
    expect(second).toHaveLength(2);
    expect((await shape(CONTROL_ID)).lines, 'the repeat added nothing and changed no price').toEqual(first.lines);
  });

  it('writing the create audit row a second time leaves one row (control: a different inspection gets its own)', async () => {
    h = await seed();
    const row = (entityId: string) => ({
      db: h!.env.DB, tenantId: TENANT_ID, userId: INSPECTOR_ID, action: 'inspection.create' as const, entityType: 'inspection' as const,
      id: `inspection.create:${entityId}`, entityId,
    });
    await writeAuditRow(row('insp-a'));
    await writeAuditRow(row('insp-a'));
    await writeAuditRow(row('insp-b'));
    const count = (entityId: string) => (h!.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE entity_id = ? AND action = 'inspection.create'").get(entityId) as { n: number }).n;
    expect(count('insp-a')).toBe(1);
    expect(count('insp-b')).toBe(1);
  });

  it('two replays finishing the same interrupted create at once leave every step written once', async () => {
    h = await seed();
    const control = await post({ ...BODY, id: CONTROL_ID });
    expect(control.status, await control.clone().text()).toBe(201);
    const expected = await shape(CONTROL_ID);
    const contactsAfterControl = await contactCount();

    h.sqlite.exec(`CREATE TRIGGER fail_step BEFORE INSERT ON reports BEGIN SELECT RAISE(ABORT, 'injected failure'); END`);
    expect((await post({ ...BODY, id: TARGET_ID })).status).toBeGreaterThanOrEqual(500);
    h.sqlite.exec('DROP TRIGGER fail_step');
    // The failed attempt got as far as the report, so take the steps it wrote away again: the two
    // replays below must each find the inspection with nothing but its row.
    for (const table of ['inspection_services', 'inspection_people', 'automation_logs', 'inspection_results']) {
      h.sqlite.prepare(`DELETE FROM ${table} WHERE inspection_id = ?`).run(TARGET_ID);
    }
    h.sqlite.prepare("DELETE FROM audit_logs WHERE entity_id = ? AND action = 'inspection.create'").run(TARGET_ID);

    const [a, b] = await Promise.all([post({ ...BODY, id: TARGET_ID }), post({ ...BODY, id: TARGET_ID })]);
    expect([a.status, b.status], `${await a.clone().text()} ${await b.clone().text()}`).toEqual([200, 200]);
    expect(await shape(TARGET_ID)).toEqual(expected);
    expect(await contactCount()).toBe(contactsAfterControl);
  });
});
