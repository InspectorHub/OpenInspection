/**
 * Version handshake through the REAL app. Every refusal is paired with a
 * positive control (same token, newer version) so a harness that rejects
 * everything cannot pass.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { app } from '../../../server/index';
import { makeExecutionContext } from '../helpers/exec-ctx';
import * as schema from '../../../server/lib/db/schema';
import { NATIVE_SCOPE, type NativeProps } from '../../../server/lib/auth/native-token';
import { buildKeyring, signJwt } from '../../../server/lib/jwt-keyring';
import { createHarness, INSPECTOR_ID, TENANT_ID, type Harness } from '../helpers/tenant-email-harness';

const nativeProps: NativeProps = {
  kind: 'native', userId: INSPECTOR_ID, tenantId: TENANT_ID, role: 'inspector', lastUsedAt: 0, grantedAt: 0,
};

const provider = {
  unwrapToken: async (t: string) => (t === 'u:g:s'
    ? { scope: [NATIVE_SCOPE], grant: { clientId: 'c', scope: [NATIVE_SCOPE], props: nativeProps } }
    : null),
};

const POLICY = { NATIVE_MIN_VERSION_IOS: '1.2.0', NATIVE_RECOMMENDED_VERSION_IOS: '1.6.0' };
const OLD = { 'X-Client-Platform': 'ios', 'X-Client-Version': '1.0.0' };
const NEW = { 'X-Client-Platform': 'ios', 'X-Client-Version': '1.7.0' };

describe('native version handshake (real app)', () => {
  let h: Harness | undefined;
  afterEach(() => { vi.useRealTimers(); h?.close(); h = undefined; });

  async function call(
    path: string,
    headers: Record<string, string> = {},
    opts: { auth?: string | null; env?: Record<string, string>; init?: RequestInit } = {},
  ): Promise<Response> {
    h ??= await createHarness('standalone');
    const env = {
      ...h.env, ...POLICY, ...opts.env, NATIVE_CLIENT_ENABLED: 'true', OAUTH_PROVIDER: provider,
    } as typeof h.env;
    const exec = makeExecutionContext({ label: 'client-version' });
    const auth = opts.auth === undefined ? 'u:g:s' : opts.auth;
    const all = { ...(auth ? { authorization: `Bearer ${auth}` } : {}), ...headers };
    const res = await app.request(path, { ...opts.init, headers: all }, env, exec.ctx);
    await exec.settle();
    return res;
  }

  it('serves the compat policy to an unauthenticated caller', async () => {
    const res = await call('/api/client/compat?platform=ios', {}, {
      auth: null, env: { NATIVE_DOWNLOAD_URL_IOS: 'https://example.com/ios' },
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: {
      minSupported: '1.2.0', recommended: '1.6.0', downloadUrl: 'https://example.com/ios', serverContractVersion: 2,
    } });
  });

  it('adds accountUrl to compat only when the operator configured a valid https URL', async () => {
    const withUrl = await call('/api/client/compat?platform=ios', {}, { auth: null, env: { NATIVE_ACCOUNT_URL: 'https://example.com/account' } });
    expect(withUrl.status, await withUrl.clone().text()).toBe(200);
    expect(((await withUrl.json()) as { data: Record<string, unknown> }).data.accountUrl).toBe('https://example.com/account');
    // Controls: unset, and each unusable value, leave the key out (not null, not empty).
    const unusable: Record<string, string>[] = [{}, { NATIVE_ACCOUNT_URL: '' }, { NATIVE_ACCOUNT_URL: 'http://example.com/account' }, { NATIVE_ACCOUNT_URL: 'javascript:alert(1)' }];
    for (const env of unusable) {
      const res = await call('/api/client/compat?platform=ios', {}, { auth: null, env });
      expect(res.status, JSON.stringify(env)).toBe(200);
      expect(((await res.json()) as { data: Record<string, unknown> }).data, JSON.stringify(env)).not.toHaveProperty('accountUrl');
    }
  });

  it('rejects an unknown platform on compat', async () => {
    const res = await call('/api/client/compat?platform=palmos', {}, { auth: null });
    expect(res.status).toBe(400);
  });

  it('answers 426 with X-Client-Upgrade: required to an old app on a normal route', async () => {
    const res = await call('/api/inspections', OLD);
    expect(res.status, await res.clone().text()).toBe(426);
    expect(res.headers.get('X-Client-Upgrade')).toBe('required');
    expect(JSON.stringify(await res.json())).toContain('CLIENT_UPGRADE_REQUIRED');
  });

  it('lets the same old app call /api/client/session (200) and flags the upgrade', async () => {
    const res = await call('/api/client/session', OLD);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(res.headers.get('X-Client-Upgrade')).toBe('required');
    const body = await res.json() as { data: unknown };
    expect(body.data).toMatchObject({ userId: INSPECTOR_ID, tenantId: TENANT_ID, role: 'inspector', offlineMaxDays: 30 });
    expect(Object.keys(body.data as object).sort()).toEqual(['offlineMaxDays', 'role', 'serverNowMs', 'tenantId', 'tenantName', 'userId']);
  });

  it('reports the tenant offlineMaxDays', async () => {
    h = await createHarness('standalone');
    await h.db.update(schema.tenantConfigs).set({ offlineMaxDays: 7 }).where(eq(schema.tenantConfigs.tenantId, TENANT_ID));
    const res = await call('/api/client/session', NEW);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(((await res.json()) as { data: { offlineMaxDays: number } }).data.offlineMaxDays).toBe(7);
  });

  describe('session serverNowMs and tenantName', () => {
    type Data = { serverNowMs: number; tenantName: string | null };
    const session = async (headers: Record<string, string> = {}, path = '/api/client/session') => {
      const res = await call(path, { ...NEW, ...headers });
      expect(res.status, await res.clone().text()).toBe(200);
      return { res, data: ((await res.json()) as { data: Data }).data };
    };

    it('reports the server clock as an integer, read at request time, and forbids caching the answer', async () => {
      h = await createHarness('standalone');
      const T = Date.UTC(2031, 4, 17, 12, 34, 56, 789);
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(T);
      const { res, data } = await session();
      expect(data.serverNowMs).toBe(T);
      expect(Number.isInteger(data.serverNowMs)).toBe(true);
      expect(res.headers.get('Cache-Control')).toBe('private, no-store');
      // Control: the value moves with the clock, so it is not a constant.
      vi.setSystemTime(T + 5000);
      expect((await session()).data.serverNowMs).toBe(T + 5000);
    });

    it('never takes the time from anything the client sends', async () => {
      h = await createHarness('standalone');
      const T = Date.UTC(2031, 4, 17, 12, 0, 0, 0);
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(T);
      const yearAgo = new Date(T - 365 * 86_400_000).toUTCString();
      const forged = { Date: yearAgo, 'X-Client-Time': String(T - 1e10), 'X-Client-Now': String(T - 1e10), 'If-Modified-Since': yearAgo };
      const { data } = await session(forged, `/api/client/session?now=${T - 1e10}&serverNowMs=1&iat=1`);
      expect(data.serverNowMs).toBe(T);
      // Control: the same request without the forged inputs answers the same value.
      expect((await session()).data.serverNowMs).toBe(T);
    });

    it('reports the trimmed company name of the signed-in tenant, and only that', async () => {
      h = await createHarness('standalone');
      await h.db.update(schema.tenantConfigs).set({ companyName: '  Acme Inspections  ' }).where(eq(schema.tenantConfigs.tenantId, TENANT_ID));
      await h.db.insert(schema.tenants).values({
        id: '11111111-0000-4000-8000-000000000002', slug: 'other-name', status: 'active', tier: 'free', maxUsers: 5,
        deploymentMode: 'shared', createdAt: new Date(),
      });
      await h.db.insert(schema.tenantConfigs).values({
        tenantId: '11111111-0000-4000-8000-000000000002', companyName: 'Other Company Ltd', updatedAt: new Date(),
      });
      const { data } = await session();
      expect(data.tenantName).toBe('Acme Inspections');
      expect(JSON.stringify(data)).not.toContain('Other Company');
    });

    it('answers null, with the key present, when the company has no usable name', async () => {
      h = await createHarness('standalone');
      for (const name of ['   ', '']) {
        await h.db.update(schema.tenantConfigs).set({ companyName: name }).where(eq(schema.tenantConfigs.tenantId, TENANT_ID));
        const { data } = await session();
        expect(data, JSON.stringify(name)).toHaveProperty('tenantName');
        expect(data.tenantName, JSON.stringify(name)).toBeNull();
      }
      // Control: a real name comes back as a string.
      await h.db.update(schema.tenantConfigs).set({ companyName: 'Acme' }).where(eq(schema.tenantConfigs.tenantId, TENANT_ID));
      expect((await session()).data.tenantName).toBe('Acme');
    });

    it('answers null, never a platform name, when the tenant has no config row', async () => {
      h = await createHarness('standalone');
      await h.db.delete(schema.tenantConfigs).where(eq(schema.tenantConfigs.tenantId, TENANT_ID));
      const { data } = await session();
      expect(data.tenantName).toBeNull();
    });

    it('reads the clock after every database round trip, not when the handler starts', async () => {
      h = await createHarness('standalone');
      const T0 = Date.UTC(2031, 4, 17, 12, 0, 0, 0);
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(T0);
      // Every statement the request runs moves the server clock on by one second, as real I/O would.
      const statements: { sql: string; at: number }[] = [];
      const real = h.env.DB;
      const DB = new Proxy(real, {
        get(target, prop) {
          if (prop !== 'prepare') {
            const v = Reflect.get(target, prop) as unknown;
            return typeof v === 'function' ? v.bind(target) : v;
          }
          return (sql: string) => {
            vi.setSystemTime(Date.now() + 1000);
            statements.push({ sql, at: Date.now() });
            return target.prepare(sql);
          };
        },
      }) as unknown as typeof real;
      const res = await call('/api/client/session', NEW, { env: { DB } as never });
      expect(res.status, await res.clone().text()).toBe(200);
      const { serverNowMs } = ((await res.json()) as { data: Data }).data;
      const config = statements.filter((st) => st.sql.includes('tenant_configs'));
      expect(config.length).toBeGreaterThan(0);
      const lastConfigRead = Math.max(...config.map((st) => st.at));
      // Control: the clock really moved while the request ran.
      expect(lastConfigRead).toBeGreaterThan(T0);
      // The answer is at least as late as the last statement that produced data for it.
      expect(serverNowMs).toBeGreaterThanOrEqual(lastConfigRead);
    });

    it('keeps the clock out of compat and out of error bodies (control: the 200 body has it)', async () => {
      h = await createHarness('standalone');
      const ok = await call('/api/client/session', NEW);
      expect(await ok.text()).toContain('serverNowMs');
      const compat = await call('/api/client/compat?platform=ios', {}, { auth: null });
      expect(compat.status).toBe(200);
      expect(await compat.text()).not.toContain('serverNowMs');
      const noToken = await call('/api/client/session', NEW, { auth: null });
      expect(noToken.status).toBe(401);
      expect(await noToken.text()).not.toContain('serverNowMs');
      const old = await call('/api/inspections', OLD);
      expect(old.status).toBe(426);
      expect(await old.text()).not.toContain('serverNowMs');
    });

    it('forbids caching the session answer for a HEAD request and for an app below the minimum version too', async () => {
      h = await createHarness('standalone');
      const head = await call('/api/client/session', NEW, { init: { method: 'HEAD' } });
      expect(head.status).toBe(200);
      expect(head.headers.get('Cache-Control')).toBe('private, no-store');
      const old = await call('/api/client/session', OLD);
      expect(old.status).toBe(200);
      expect(old.headers.get('X-Client-Upgrade')).toBe('required');
      expect(old.headers.get('Cache-Control')).toBe('private, no-store');
      // Control: a route that does not carry the clock is not given the header by this rule.
      const compat = await call('/api/client/compat?platform=ios', {}, { auth: null });
      expect(compat.headers.get('Cache-Control')).not.toBe('private, no-store');
    });

    it('reads the name and the offline limit from the signed-in company only, even when another company has a row', async () => {
      h = await createHarness('standalone');
      const OTHER = '11111111-0000-4000-8000-000000000002';
      await h.db.insert(schema.tenants).values({
        id: OTHER, slug: 'other-scope', status: 'active', tier: 'free', maxUsers: 5, deploymentMode: 'shared', createdAt: new Date(),
      });
      await h.db.insert(schema.tenantConfigs).values({ tenantId: OTHER, companyName: 'Other Company Ltd', offlineMaxDays: 7, updatedAt: new Date() });
      // This company has no row of its own, so any read that is not scoped to it would find the other one.
      await h.db.delete(schema.tenantConfigs).where(eq(schema.tenantConfigs.tenantId, TENANT_ID));
      const none = (await session()).data as unknown as { tenantName: string | null; offlineMaxDays: number };
      expect(none.tenantName).toBeNull();
      expect(none.offlineMaxDays).toBe(30);
      // Control: once this company has its own row, that row is what is read.
      await h.db.insert(schema.tenantConfigs).values({ tenantId: TENANT_ID, companyName: 'Own Company', offlineMaxDays: 12, updatedAt: new Date() });
      const own = (await session()).data as unknown as { tenantName: string; offlineMaxDays: number };
      expect(own.tenantName).toBe('Own Company');
      expect(own.offlineMaxDays).toBe(12);
    });

    it('caps a very long name at 200 characters without splitting a character', async () => {
      h = await createHarness('standalone');
      await h.db.update(schema.tenantConfigs).set({ companyName: 'x'.repeat(300) }).where(eq(schema.tenantConfigs.tenantId, TENANT_ID));
      expect((await session()).data.tenantName).toBe('x'.repeat(200));
      // 300 astral characters have a UTF-16 length of 600. The cap counts characters, so exactly 200 survive whole.
      await h.db.update(schema.tenantConfigs).set({ companyName: '\u{1F3E0}'.repeat(300) }).where(eq(schema.tenantConfigs.tenantId, TENANT_ID));
      const name = (await session()).data.tenantName as string;
      expect(Array.from(name)).toHaveLength(200);
      expect(name).toBe('\u{1F3E0}'.repeat(200));
    });
  });

  it('does not 426 an old app on the existing collab sync path, while /api/inspections still does', async () => {
    // The route answers 426 itself when `Upgrade: websocket` is absent, so the
    // header is sent: any other status proves the version rule stayed out of it.
    const sync = await call('/api/inspections/00000000-0000-4000-8000-0000000000c1/collab/ws', { ...OLD, Upgrade: 'websocket' });
    expect(sync.status, await sync.clone().text()).not.toBe(426);
    expect(sync.headers.get('X-Client-Upgrade')).toBe('required');
    expect((await call('/api/inspections', OLD)).status).toBe(426);
  });

  it('does not 426 an old app on the REST writes that hand over captured work, while the reads on the same paths still do', async () => {
    const id = '00000000-0000-4000-8000-0000000000c1';
    const json = (method: string) => ({ init: { method, body: '{}' } });
    const headers = { ...OLD, 'content-type': 'application/json' };
    // Whatever the route answers to an empty body (a validation error is fine), it is not the version rule.
    for (const [method, path] of [['POST', '/api/inspections'], ['PATCH', `/api/inspections/${id}`], ['POST', `/api/inspections/${id}/complete`]] as const) {
      const res = await call(path, headers, json(method));
      expect(res.status, `${method} ${path}: ${await res.clone().text()}`).not.toBe(426);
      expect(res.headers.get('X-Client-Upgrade')).toBe('required');
    }
    // Controls: the version rule is live for this caller on the reads and on the other verbs.
    expect((await call('/api/inspections', OLD)).status).toBe(426);
    expect((await call(`/api/inspections/${id}`, OLD)).status).toBe(426);
    expect((await call(`/api/inspections/${id}`, headers, json('DELETE'))).status).toBe(426);
  });

  it('does not 426 an old app on the offline import path, while a sibling POST under the same inspection still does', async () => {
    const id = '00000000-0000-4000-8000-0000000000c1';
    const body = Uint8Array.from([1, 2, 3]);
    const init = { method: 'POST', body };
    const headers = { ...OLD, 'content-length': String(body.length) };
    const imp = await call(`/api/inspections/${id}/collab/import`, headers, { init });
    expect(imp.status, await imp.clone().text()).not.toBe(426);
    expect(imp.headers.get('X-Client-Upgrade')).toBe('required');
    // Control: the version rule is live for this caller and path family.
    expect((await call(`/api/inspections/${id}/collab/restore`, headers, { init })).status).toBe(426);
  });

  it('lets a current app through with no upgrade header', async () => {
    const res = await call('/api/inspections', NEW);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(res.headers.get('X-Client-Upgrade')).toBeNull();
  });

  it('flags a below-recommended app without blocking it', async () => {
    const res = await call('/api/inspections', { 'X-Client-Platform': 'ios', 'X-Client-Version': '1.3.0' });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(res.headers.get('X-Client-Upgrade')).toBe('recommended');
  });

  it('fails open when the platform header is missing or invalid', async () => {
    const cases: Record<string, string>[] = [{ 'X-Client-Version': '1.0.0' }, { 'X-Client-Platform': 'palmos', 'X-Client-Version': '1.0.0' }];
    for (const headers of cases) {
      const res = await call('/api/inspections', headers);
      expect(res.status, await res.clone().text()).toBe(200);
      expect(res.headers.get('X-Client-Upgrade')).toBeNull();
    }
  });

  it('does not apply to a session-JWT caller, even with an old version header', async () => {
    h = await createHarness('standalone');
    const keyring = await buildKeyring(h.env as unknown as Record<string, string | undefined>);
    const now = Math.floor(Date.now() / 1000);
    const jwt = await signJwt({
      sub: INSPECTOR_ID, role: 'inspector', 'custom:userRole': 'inspector', 'custom:tenantId': TENANT_ID, iat: now, exp: now + 3600,
    }, keyring);
    const res = await call('/api/inspections', OLD, { auth: jwt });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(res.headers.get('X-Client-Upgrade')).toBeNull();
    // Positive control: the same headers on the native token are refused.
    expect((await call('/api/inspections', OLD)).status).toBe(426);
  });

  it('answers 401 on /api/client/session to a browser session JWT (positive control: the native token gets 200)', async () => {
    h = await createHarness('standalone');
    const keyring = await buildKeyring(h.env as unknown as Record<string, string | undefined>);
    const now = Math.floor(Date.now() / 1000);
    const jwt = await signJwt({
      sub: INSPECTOR_ID, role: 'inspector', 'custom:userRole': 'inspector', 'custom:tenantId': TENANT_ID, iat: now, exp: now + 3600,
    }, keyring);
    // The same signed token authenticates an ordinary route, so the refusal below is about the session route.
    expect((await call('/api/inspections', NEW, { auth: jwt })).status).toBe(200);
    const asBearer = await call('/api/client/session', NEW, { auth: jwt });
    expect(asBearer.status, await asBearer.clone().text()).toBe(401);
    const asCookie = await call('/api/client/session', { ...NEW, cookie: `__Host-inspector_token=${jwt}` }, { auth: null });
    expect(asCookie.status, await asCookie.clone().text()).toBe(401);
    expect((await call('/api/client/session', NEW)).status).toBe(200);
  });
});
