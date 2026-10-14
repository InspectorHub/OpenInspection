/**
 * A client-supplied inspection id makes an offline create naturally idempotent.
 *
 * The Idempotency-Key table keeps a key for 24 hours; a device can stay offline
 * far longer than that and then replay its create. These specs drive the REAL
 * app and deliberately send NO Idempotency-Key, which is what a replay after
 * the window looks like: the only thing standing between the replay and a
 * second inspection is the id.
 *
 * Every refusal is paired with a positive control (the same call with a fresh
 * id, or without an id, still creates).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { eq, count } from 'drizzle-orm';
import { app } from '../../../server/index';
import { InspectionService } from '../../../server/services/inspection.service';
import { makeExecutionContext } from '../helpers/exec-ctx';
import * as schema from '../../../server/lib/db/schema';
import { buildKeyring, signJwt } from '../../../server/lib/jwt-keyring';
import { createHarness, INSPECTOR_ID, TENANT_ID, type Harness } from '../helpers/tenant-email-harness';

const OTHER_TENANT_ID = '11111111-0000-4000-8000-0000000000ff';
const CLIENT_ID = '33333333-0000-4000-8000-000000000001';

const BODY = {
  propertyAddress: '12 Offline Lane, Anytown',
  templateId: 'tpl-offline',
  date: '2026-06-01T10:00:00.000Z',
};

/** The harness plus the one template every create below points at (templates_id is a foreign key). */
async function harness(): Promise<Harness> {
  const created = await createHarness('standalone');
  await created.db.insert(schema.templates).values({
    id: BODY.templateId, tenantId: TENANT_ID, name: 'Standard', schema: { sections: [] }, version: 1, createdAt: new Date(),
  } as typeof schema.templates.$inferInsert);
  return created;
}

describe('POST /api/inspections with a client-generated id', () => {
  let h: Harness | undefined;
  afterEach(() => { h?.close(); h = undefined; });

  async function post(path: string, body: unknown): Promise<Response> {
    h ??= await harness();
    const keyring = await buildKeyring(h.env as unknown as Record<string, string | undefined>);
    const now = Math.floor(Date.now() / 1000);
    const jwt = await signJwt({
      sub: INSPECTOR_ID, role: 'inspector', 'custom:userRole': 'inspector', 'custom:tenantId': TENANT_ID, iat: now, exp: now + 3600,
    }, keyring);
    const exec = makeExecutionContext({ label: 'create-with-client-id' });
    const res = await app.request(path, {
      method: 'POST',
      headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }, h.env, exec.ctx);
    await exec.settle();
    return res;
  }

  async function inspectionCount(): Promise<number> {
    const row = await h!.db.select({ n: count() }).from(schema.inspections).get();
    return row?.n ?? 0;
  }

  it('creates the inspection under the id the client chose', async () => {
    const res = await post('/api/inspections', { ...BODY, id: CLIENT_ID });
    expect(res.status, await res.clone().text()).toBe(201);
    const body = await res.json() as { data: { inspection: { id: string } } };
    expect(body.data.inspection.id).toBe(CLIENT_ID);
    const row = await h!.db.select().from(schema.inspections).where(eq(schema.inspections.id, CLIENT_ID)).get();
    expect(row?.tenantId).toBe(TENANT_ID);
  });

  it('answers a replay with the same inspection and creates no second one (no Idempotency-Key sent)', async () => {
    const first = await post('/api/inspections', { ...BODY, id: CLIENT_ID });
    expect(first.status, await first.clone().text()).toBe(201);
    const replay = await post('/api/inspections', { ...BODY, id: CLIENT_ID });
    expect(replay.status, await replay.clone().text()).toBe(200);
    const body = await replay.json() as { success: boolean; data: { inspection: { id: string; propertyAddress: string } } };
    expect(body.success).toBe(true);
    expect(body.data.inspection.id).toBe(CLIENT_ID);
    expect(body.data.inspection.propertyAddress).toBe(BODY.propertyAddress);
    expect(await inspectionCount()).toBe(1);
    // The replay did not run the create's side effects a second time.
    const results = await h!.db.select({ n: count() }).from(schema.inspectionResults).get();
    expect(results?.n).toBe(1);
    const audits = await h!.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, 'inspection.create')).all();
    expect(audits).toHaveLength(1);
  });

  it('refuses an id that another tenant already holds with 409 ID_CONFLICT and leaves that row alone', async () => {
    h = await harness();
    await h.db.insert(schema.tenants).values({
      id: OTHER_TENANT_ID, slug: 'other-co', status: 'active', tier: 'free',
      maxUsers: 5, deploymentMode: 'shared', createdAt: new Date(),
    });
    await h.db.insert(schema.inspections).values({
      id: CLIENT_ID, tenantId: OTHER_TENANT_ID, propertyAddress: '99 Other Street', status: 'requested',
      date: '2026-06-01', createdAt: new Date(),
    } as typeof schema.inspections.$inferInsert);

    const res = await post('/api/inspections', { ...BODY, id: CLIENT_ID });
    expect(res.status, await res.clone().text()).toBe(409);
    expect(JSON.stringify(await res.json())).toContain('ID_CONFLICT');
    const rows = await h.db.select().from(schema.inspections).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tenantId).toBe(OTHER_TENANT_ID);
    expect(rows[0]?.propertyAddress).toBe('99 Other Street');

    // Positive control: the same caller, the same body, a free id, creates.
    const fresh = await post('/api/inspections', { ...BODY, id: '33333333-0000-4000-8000-000000000002' });
    expect(fresh.status, await fresh.clone().text()).toBe(201);
  });

  it('rejects an id with characters that are unsafe in storage keys and URLs', async () => {
    const res = await post('/api/inspections', { ...BODY, id: 'bad id/../x' });
    expect(res.status).toBe(400);
    expect(await inspectionCount()).toBe(0);
  });

  it('still generates the id server-side when none is sent (control), one row per call', async () => {
    const a = await post('/api/inspections', BODY);
    const b = await post('/api/inspections', BODY);
    expect(a.status, await a.clone().text()).toBe(201);
    expect(b.status, await b.clone().text()).toBe(201);
    const ida = ((await a.json()) as { data: { inspection: { id: string } } }).data.inspection.id;
    const idb = ((await b.json()) as { data: { inspection: { id: string } } }).data.inspection.id;
    expect(ida).not.toBe(idb);
    expect(await inspectionCount()).toBe(2);
  });

  it('two concurrent creates with the same id yield one inspection and no 500', async () => {
    h = await harness();
    const [a, b] = await Promise.all([
      post('/api/inspections', { ...BODY, id: CLIENT_ID }),
      post('/api/inspections', { ...BODY, id: CLIENT_ID }),
    ]);
    expect([a.status, b.status].every((s) => s === 200 || s === 201), `${a.status} ${b.status}`).toBe(true);
    expect(await inspectionCount()).toBe(1);
  });
});

describe('POST /api/inspections with a client id: two requests that both pass the early check', () => {
  let h: Harness | undefined;
  afterEach(() => { vi.restoreAllMocks(); h?.close(); h = undefined; });

  const DISCOUNT_ID = 'dc-offline-1';

  async function seed(mode: 'saas' | 'standalone'): Promise<Harness> {
    const created = await createHarness(mode);
    await created.db.insert(schema.templates).values({
      id: BODY.templateId, tenantId: TENANT_ID, name: 'Standard', schema: { sections: [] }, version: 1, createdAt: new Date(),
    } as typeof schema.templates.$inferInsert);
    await created.db.insert(schema.discountCodes).values({
      id: DISCOUNT_ID, tenantId: TENANT_ID, code: 'OFFLINE10', type: 'fixed', value: 1000, maxUses: null, usesCount: 0, createdAt: new Date(),
    });
    return created;
  }

  /** Holds the first two early-check lookups until both have arrived, so both requests see "no such inspection". */
  function interleaveEarlyChecks(): void {
    let arrived = 0;
    let release: () => void = () => undefined;
    const bothArrived = new Promise<void>((resolve) => { release = resolve; });
    const original = InspectionService.prototype.findInspectionById;
    vi.spyOn(InspectionService.prototype, 'findInspectionById').mockImplementation(async function (this: InspectionService, tenantId: string, id: string) {
      if (arrived >= 2) return original.call(this, tenantId, id);
      arrived += 1;
      if (arrived === 2) release();
      await bothArrived;
      return null;
    });
  }

  async function post(body: unknown): Promise<Response> {
    const keyring = await buildKeyring(h!.env as unknown as Record<string, string | undefined>);
    const now = Math.floor(Date.now() / 1000);
    const jwt = await signJwt({
      sub: INSPECTOR_ID, role: 'inspector', 'custom:userRole': 'inspector', 'custom:tenantId': TENANT_ID, iat: now, exp: now + 3600,
    }, keyring);
    const exec = makeExecutionContext({ label: 'create-race' });
    const res = await app.request('/api/inspections', {
      method: 'POST',
      headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }, h!.env, exec.ctx);
    await exec.settle();
    return res;
  }

  it('consumes the allowance, the discount and the audit trail once, and answers the loser 200', async () => {
    h = await seed('saas');
    interleaveEarlyChecks();
    const body = { ...BODY, id: CLIENT_ID, discountCodeId: DISCOUNT_ID, discountAmount: 1000 };
    const [a, b] = await Promise.all([post(body), post(body)]);
    expect([a.status, b.status].sort(), `${await a.clone().text()} ${await b.clone().text()}`).toEqual([200, 201]);

    const rows = await h.db.select().from(schema.inspections).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.discountCodeId).toBe(DISCOUNT_ID);
    const code = await h.db.select().from(schema.discountCodes).where(eq(schema.discountCodes.id, DISCOUNT_ID)).get();
    expect(code?.usesCount).toBe(1);
    const counter = await h.db.select().from(schema.usageCounters).where(eq(schema.usageCounters.metric, 'inspections')).get();
    expect(counter?.value).toBe(1);
    const audits = await h.db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, 'inspection.create')).all();
    expect(audits).toHaveLength(1);
  });

  it('refunds the allowance when the id belongs to another workspace (409), and a fresh id still creates (control)', async () => {
    h = await seed('saas');
    await h.db.insert(schema.tenants).values({
      id: OTHER_TENANT_ID, slug: 'other-co', status: 'active', tier: 'free',
      maxUsers: 5, deploymentMode: 'shared', createdAt: new Date(),
    });
    await h.db.insert(schema.inspections).values({
      id: CLIENT_ID, tenantId: OTHER_TENANT_ID, propertyAddress: '99 Other Street', status: 'requested',
      date: '2026-06-01', createdAt: new Date(),
    } as typeof schema.inspections.$inferInsert);

    const refused = await post({ ...BODY, id: CLIENT_ID, discountCodeId: DISCOUNT_ID, discountAmount: 1000 });
    expect(refused.status, await refused.clone().text()).toBe(409);
    const afterRefusal = await h.db.select().from(schema.usageCounters).where(eq(schema.usageCounters.tenantId, TENANT_ID)).all();
    expect(afterRefusal.find((r) => r.metric === 'inspections')?.value ?? 0).toBe(0);
    const code = await h.db.select().from(schema.discountCodes).where(eq(schema.discountCodes.id, DISCOUNT_ID)).get();
    expect(code?.usesCount).toBe(0);

    const fresh = await post({ ...BODY, id: '33333333-0000-4000-8000-000000000002' });
    expect(fresh.status, await fresh.clone().text()).toBe(201);
    const afterFresh = await h.db.select().from(schema.usageCounters).where(eq(schema.usageCounters.tenantId, TENANT_ID)).all();
    expect(afterFresh.find((r) => r.metric === 'inspections')?.value).toBe(1);
  });
});

describe('POST /api/inspections/{id}/complete replay', () => {
  let h: Harness | undefined;
  afterEach(() => { h?.close(); h = undefined; });

  it('answers 200 with the same body when the inspection is already completed', async () => {
    h = await harness();
    const keyring = await buildKeyring(h.env as unknown as Record<string, string | undefined>);
    const now = Math.floor(Date.now() / 1000);
    const jwt = await signJwt({
      sub: INSPECTOR_ID, role: 'inspector', 'custom:userRole': 'inspector', 'custom:tenantId': TENANT_ID, iat: now, exp: now + 3600,
    }, keyring);
    const call = async (path: string, body?: unknown): Promise<Response> => {
      const exec = makeExecutionContext({ label: 'complete-replay' });
      const res = await app.request(path, {
        method: 'POST',
        headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      }, h!.env, exec.ctx);
      await exec.settle();
      return res;
    };
    const created = await call('/api/inspections', { ...BODY, id: CLIENT_ID });
    expect(created.status, await created.clone().text()).toBe(201);

    const first = await call(`/api/inspections/${CLIENT_ID}/complete`);
    expect(first.status, await first.clone().text()).toBe(200);
    const firstBody = await first.json();
    const replay = await call(`/api/inspections/${CLIENT_ID}/complete`);
    expect(replay.status, await replay.clone().text()).toBe(200);
    expect(await replay.json()).toEqual(firstBody);

    const row = await h.db.select().from(schema.inspections).where(eq(schema.inspections.id, CLIENT_ID)).get();
    expect(row?.status).toBe('completed');
    // Positive control: an unknown id is still refused, so the 200 above is not a catch-all.
    const missing = await call('/api/inspections/33333333-0000-4000-8000-0000000000aa/complete');
    expect(missing.status).toBe(404);
  });
});
