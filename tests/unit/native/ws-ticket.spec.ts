/**
 * One-time WebSocket tickets through the REAL app: real middleware chain, real
 * collab authorization (tenant scoping, roster, primary report) over an
 * in-memory database. Only the Durable Object namespaces are doubles, because a
 * 101 upgrade cannot be produced outside workerd; what matters here is whether
 * the route reached them and with whose identity.
 *
 * Every refusal has a positive control (the same ticket, used correctly once).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import { app } from '../../../server/index';
import { makeExecutionContext } from '../helpers/exec-ctx';
import * as schema from '../../../server/lib/db/schema';
import { createPrimaryReport } from '../../../server/lib/inspection/reports';
import { NATIVE_SCOPE, type NativeProps } from '../../../server/lib/auth/native-token';
import { createHarness, INSPECTOR_ID, TENANT_ID, type Harness } from '../helpers/tenant-email-harness';

const OTHER_INSPECTOR_ID = '22222222-0000-4000-8000-000000000003';
const OTHER_TENANT_ID = '11111111-0000-4000-8000-000000000002';
const OTHER_TENANT_INSPECTOR_ID = '22222222-0000-4000-8000-000000000004';
const MINE = 'insp-ticket-mine';
const ALSO_MINE = 'insp-ticket-also-mine';
const NOT_MINE = 'insp-ticket-other-tenant';

function propsFor(userId: string, tenantId: string): NativeProps {
  return { kind: 'native', userId, tenantId, role: 'inspector', lastUsedAt: 0 };
}
const PROPS: Record<string, NativeProps> = {
  'u:g:s': propsFor(INSPECTOR_ID, TENANT_ID),
  'u2:g:s': propsFor(OTHER_INSPECTOR_ID, TENANT_ID),
};
const provider = {
  unwrapToken: async (t: string) => {
    const props = PROPS[t];
    return props ? { scope: [NATIVE_SCOPE], grant: { clientId: 'c', scope: [NATIVE_SCOPE], props } } : null;
  },
};

function doNamespace() {
  const stubFetch = vi.fn(async (_req: Request) => new Response(null, { status: 200 }));
  return { idFromName: vi.fn(() => ({})), get: vi.fn(() => ({ fetch: stubFetch })), stubFetch };
}

describe('one-time WebSocket tickets (real app)', () => {
  let h: Harness | undefined;
  afterEach(() => { h?.close(); h = undefined; });

  async function setup() {
    h = await createHarness('standalone');
    const now = new Date();
    await h.db.insert(schema.users).values({
      id: OTHER_INSPECTOR_ID, tenantId: TENANT_ID, email: 'ines@harbor-light.test', passwordHash: 'h',
      role: 'inspector', name: 'Ines Inspector', createdAt: now,
    });
    await h.db.insert(schema.tenants).values({
      id: OTHER_TENANT_ID, slug: 'other-ticket', status: 'active', tier: 'free', maxUsers: 5,
      deploymentMode: 'shared', createdAt: now,
    });
    await h.db.insert(schema.users).values({
      id: OTHER_TENANT_INSPECTOR_ID, tenantId: OTHER_TENANT_ID, email: 'oscar@other.test', passwordHash: 'h',
      role: 'inspector', name: 'Oscar', createdAt: now,
    });
    for (const [id, tenantId, inspectorId] of [
      [MINE, TENANT_ID, INSPECTOR_ID], [ALSO_MINE, TENANT_ID, INSPECTOR_ID], [NOT_MINE, OTHER_TENANT_ID, OTHER_TENANT_INSPECTOR_ID],
    ] as const) {
      await h.db.insert(schema.inspections).values({
        id, tenantId, inspectorId, propertyAddress: '1 Main', date: '2026-06-01',
        status: 'confirmed', paymentStatus: 'paid', price: 0, createdAt: now,
      });
      await h.db.insert(schema.inspectionInspectors).values({
        inspectionId: id, userId: inspectorId, tenantId, role: 'lead', createdAt: now,
      });
      await createPrimaryReport(h.db, tenantId, id, null);
    }
    const collab = doNamespace();
    const presence = doNamespace();
    const env = {
      ...h.env, NATIVE_CLIENT_ENABLED: 'true', OAUTH_PROVIDER: provider,
      INSPECTION_DOC: collab, INSPECTION_PRESENCE: presence,
    } as unknown as typeof h.env;
    const kv = h.env.TENANT_CACHE as unknown as { put: Mock<(...a: unknown[]) => Promise<void>>; get: Mock<(...a: unknown[]) => Promise<string | null>>; delete: Mock<(k: string) => Promise<void>> };

    async function call(path: string, init: RequestInit = {}): Promise<Response> {
      const exec = makeExecutionContext({ label: 'ws-ticket' });
      const res = await app.request(path, init, env, exec.ctx);
      await exec.settle();
      return res;
    }
    const issue = (inspectionId: string, token: string | null = 'u:g:s') => call(`/api/inspections/${inspectionId}/collab/ticket`, {
      method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const issued = async (inspectionId: string, token = 'u:g:s'): Promise<string> => {
      const res = await issue(inspectionId, token);
      expect(res.status, await res.clone().text()).toBe(200);
      return ((await res.json()) as { data: { ticket: string } }).data.ticket;
    };
    const upgrade = (path: string, ticket?: string) => call(ticket ? `${path}?ticket=${ticket}` : path, { headers: { Upgrade: 'websocket' } });
    return { collab, presence, kv, call, issue, issued, upgrade, env };
  }

  it('issues { ticket, expiresIn: 60 } to a native session and stores it for 60 seconds under wsticket:', async () => {
    const t = await setup();
    const res = await t.issue(MINE);
    expect(res.status, await res.clone().text()).toBe(200);
    const body = await res.json() as { success: boolean; data: { ticket: string; expiresIn: number } };
    expect(body.success).toBe(true);
    expect(body.data.expiresIn).toBe(60);
    expect(body.data.ticket.length).toBeGreaterThanOrEqual(32);
    const [key, value, options] = t.kv.put.mock.calls.find((c) => String(c[0]).startsWith('wsticket:')) ?? [];
    expect(key).toBe(`wsticket:${body.data.ticket}`);
    expect(options).toEqual({ expirationTtl: 60 });
    expect(JSON.parse(String(value))).toEqual({ tenantId: TENANT_ID, userId: INSPECTOR_ID, role: 'inspector', inspectionId: MINE });
  });

  it('issues distinct tickets each time', async () => {
    const t = await setup();
    expect(await t.issued(MINE)).not.toBe(await t.issued(MINE));
  });

  it('refuses to issue without a native identity (401), and issues nothing', async () => {
    const t = await setup();
    expect((await t.issue(MINE, null)).status).toBe(401);
    expect((await t.issue(MINE, 'not-a-token')).status).toBe(401);
    expect(t.kv.put.mock.calls.filter((c) => String(c[0]).startsWith('wsticket:'))).toHaveLength(0);
  });

  it('refuses to issue for an inspection the caller may not open: other tenant 404, not on the roster 403', async () => {
    const t = await setup();
    expect((await t.issue(NOT_MINE)).status).toBe(404);
    expect((await t.issue(MINE, 'u2:g:s')).status).toBe(403);
    expect(t.kv.put.mock.calls.filter((c) => String(c[0]).startsWith('wsticket:'))).toHaveLength(0);
    // Control: the assigned inspector gets one for the same inspection.
    expect(typeof (await t.issued(MINE))).toBe('string');
  });

  it('a ticket opens the collab socket as the issuing user, through the full authorization', async () => {
    const t = await setup();
    const ticket = await t.issued(MINE);
    const res = await t.upgrade(`/api/inspections/${MINE}/collab/ws`, ticket);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(t.collab.stubFetch).toHaveBeenCalledTimes(1);
    const fwd = t.collab.stubFetch.mock.calls[0]?.[0];
    expect(fwd?.headers.get('x-tenant-id')).toBe(TENANT_ID);
    expect(fwd?.headers.get('x-user-id')).toBe(INSPECTOR_ID);
    expect(fwd?.headers.get('x-inspection-id')).toBe(MINE);
  });

  it('a ticket opens the inspection presence socket too', async () => {
    const t = await setup();
    const ticket = await t.issued(MINE);
    const res = await t.upgrade(`/api/inspections/${MINE}/presence/ws`, ticket);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(t.presence.stubFetch).toHaveBeenCalledTimes(1);
    expect(t.presence.stubFetch.mock.calls[0]?.[0].headers.get('x-user-id')).toBe(INSPECTOR_ID);
  });

  it('is one-time: the first use connects, the second is 401', async () => {
    const t = await setup();
    const ticket = await t.issued(MINE);
    expect((await t.upgrade(`/api/inspections/${MINE}/collab/ws`, ticket)).status).toBe(200);
    expect((await t.upgrade(`/api/inspections/${MINE}/collab/ws`, ticket)).status).toBe(401);
    expect(t.collab.stubFetch).toHaveBeenCalledTimes(1);
  });

  it('an expired ticket is 401 (the store drops it at its TTL)', async () => {
    const t = await setup();
    const ticket = await t.issued(MINE);
    await t.kv.delete(`wsticket:${ticket}`);
    expect((await t.upgrade(`/api/inspections/${MINE}/collab/ws`, ticket)).status).toBe(401);
    // Control: a fresh one works.
    expect((await t.upgrade(`/api/inspections/${MINE}/collab/ws`, await t.issued(MINE))).status).toBe(200);
  });

  it('a ticket bound to one inspection is 401 on another, even one the user may open', async () => {
    const t = await setup();
    const ticket = await t.issued(MINE);
    const wrong = await t.upgrade(`/api/inspections/${ALSO_MINE}/collab/ws`, ticket);
    expect(wrong.status).toBe(401);
    expect(t.collab.stubFetch).not.toHaveBeenCalled();
    // The mismatch spent it, so a ticket is not probed for fit.
    expect((await t.upgrade(`/api/inspections/${MINE}/collab/ws`, ticket)).status).toBe(401);
    // Control: a ticket issued for ALSO_MINE opens ALSO_MINE.
    expect((await t.upgrade(`/api/inspections/${ALSO_MINE}/collab/ws`, await t.issued(ALSO_MINE))).status).toBe(200);
  });

  it('an unknown ticket is 401; no ticket and no cookie is 401 (unchanged)', async () => {
    const t = await setup();
    expect((await t.upgrade(`/api/inspections/${MINE}/collab/ws`, 'guess')).status).toBe(401);
    expect((await t.upgrade(`/api/inspections/${MINE}/collab/ws`)).status).toBe(401);
    expect((await t.upgrade(`/api/inspections/${MINE}/presence/ws`)).status).toBe(401);
    expect(t.collab.stubFetch).not.toHaveBeenCalled();
    expect(t.presence.stubFetch).not.toHaveBeenCalled();
  });

  it('a ticket is no pass for ordinary calls: ?ticket= on /api/inspections is 401, with or without an Upgrade header', async () => {
    const t = await setup();
    const ticket = await t.issued(MINE);
    expect((await t.call(`/api/inspections?ticket=${ticket}`)).status).toBe(401);
    expect((await t.upgrade('/api/inspections', ticket)).status).toBe(401);
    expect((await t.call(`/api/inspections/${MINE}/collab/snapshots?ticket=${ticket}`, { headers: { Upgrade: 'websocket' } })).status).toBe(401);
    // Not even looked at, let alone spent: it still opens its socket.
    expect((await t.upgrade(`/api/inspections/${MINE}/collab/ws`, ticket)).status).toBe(200);
  });

  it('a ticket presented on a request that is not an upgrade is not spent', async () => {
    const t = await setup();
    const ticket = await t.issued(MINE);
    const plain = await t.call(`/api/inspections/${MINE}/collab/ws?ticket=${ticket}`);
    expect(plain.status).toBe(426);
    expect((await t.upgrade(`/api/inspections/${MINE}/collab/ws`, ticket)).status).toBe(200);
  });

  it('a ticket cannot reach another tenant\'s inspection: the full collab checks still run (404, DO untouched)', async () => {
    const t = await setup();
    // Not issuable through the route (see above), so forge the stored value to prove
    // the socket-side checks stand on their own.
    await t.kv.put('wsticket:forged', JSON.stringify({
      tenantId: TENANT_ID, userId: INSPECTOR_ID, role: 'inspector', inspectionId: NOT_MINE,
    }));
    const res = await t.upgrade(`/api/inspections/${NOT_MINE}/collab/ws`, 'forged');
    expect(res.status).toBe(404);
    expect(t.collab.stubFetch).not.toHaveBeenCalled();
  });

  it('a ticket for a user off the roster is 403 at the socket, not just at issue time', async () => {
    const t = await setup();
    await t.kv.put('wsticket:offroster', JSON.stringify({
      tenantId: TENANT_ID, userId: OTHER_INSPECTOR_ID, role: 'inspector', inspectionId: MINE,
    }));
    expect((await t.upgrade(`/api/inspections/${MINE}/collab/ws`, 'offroster')).status).toBe(403);
    expect(t.collab.stubFetch).not.toHaveBeenCalled();
  });

  it('a malformed stored ticket is 401', async () => {
    const t = await setup();
    await t.kv.put('wsticket:junk', '{"tenantId":1}');
    expect((await t.upgrade(`/api/inspections/${MINE}/collab/ws`, 'junk')).status).toBe(401);
  });

  it('tickets are ignored when native clients are switched off', async () => {
    const t = await setup();
    const ticket = await t.issued(MINE);
    const exec = makeExecutionContext({ label: 'ws-ticket-off' });
    const off = { ...t.env, NATIVE_CLIENT_ENABLED: '0' };
    const res = await app.request(`/api/inspections/${MINE}/collab/ws?ticket=${ticket}`, { headers: { Upgrade: 'websocket' } }, off, exec.ctx);
    await exec.settle();
    expect(res.status).toBe(401);
  });
});
