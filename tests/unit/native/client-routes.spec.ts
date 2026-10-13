/**
 * Version handshake through the REAL app. Every refusal is paired with a
 * positive control (same token, newer version) so a harness that rejects
 * everything cannot pass.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { app } from '../../../server/index';
import { makeExecutionContext } from '../helpers/exec-ctx';
import * as schema from '../../../server/lib/db/schema';
import { NATIVE_SCOPE, type NativeProps } from '../../../server/lib/auth/native-token';
import { buildKeyring, signJwt } from '../../../server/lib/jwt-keyring';
import { createHarness, INSPECTOR_ID, TENANT_ID, type Harness } from '../helpers/tenant-email-harness';

const nativeProps: NativeProps = {
  kind: 'native', userId: INSPECTOR_ID, tenantId: TENANT_ID, role: 'inspector', lastUsedAt: 0,
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
  afterEach(() => { h?.close(); h = undefined; });

  async function call(
    path: string,
    headers: Record<string, string> = {},
    opts: { auth?: string | null; env?: Record<string, string> } = {},
  ): Promise<Response> {
    h ??= await createHarness('standalone');
    const env = {
      ...h.env, ...POLICY, ...opts.env, NATIVE_CLIENT_ENABLED: 'true', OAUTH_PROVIDER: provider,
    } as typeof h.env;
    const exec = makeExecutionContext({ label: 'client-version' });
    const auth = opts.auth === undefined ? 'u:g:s' : opts.auth;
    const all = { ...(auth ? { authorization: `Bearer ${auth}` } : {}), ...headers };
    const res = await app.request(path, { headers: all }, env, exec.ctx);
    await exec.settle();
    return res;
  }

  it('serves the compat policy to an unauthenticated caller', async () => {
    const res = await call('/api/client/compat?platform=ios', {}, {
      auth: null, env: { NATIVE_DOWNLOAD_URL_IOS: 'https://example.com/ios' },
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: {
      minSupported: '1.2.0', recommended: '1.6.0', downloadUrl: 'https://example.com/ios', serverContractVersion: 1,
    } });
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
    expect(body.data).toEqual({ userId: INSPECTOR_ID, tenantId: TENANT_ID, role: 'inspector', offlineMaxDays: 30 });
  });

  it('reports the tenant offlineMaxDays', async () => {
    h = await createHarness('standalone');
    await h.db.update(schema.tenantConfigs).set({ offlineMaxDays: 7 }).where(eq(schema.tenantConfigs.tenantId, TENANT_ID));
    const res = await call('/api/client/session', NEW);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(((await res.json()) as { data: { offlineMaxDays: number } }).data.offlineMaxDays).toBe(7);
  });

  it('does not 426 an old app on the existing collab sync path, while /api/inspections still does', async () => {
    // The route answers 426 itself when `Upgrade: websocket` is absent, so the
    // header is sent: any other status proves the version rule stayed out of it.
    const sync = await call('/api/inspections/00000000-0000-4000-8000-0000000000c1/collab/ws', { ...OLD, Upgrade: 'websocket' });
    expect(sync.status, await sync.clone().text()).not.toBe(426);
    expect(sync.headers.get('X-Client-Upgrade')).toBe('required');
    expect((await call('/api/inspections', OLD)).status).toBe(426);
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
});
