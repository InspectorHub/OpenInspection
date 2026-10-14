/**
 * Native OAuth access tokens on /api/*.
 *
 * The OAuth provider issues opaque tokens (`userId:grantId:secret`). A native
 * client holds one with the `native` scope; an MCP client holds one without it.
 * Only the former may drive /api/*, because MCP scopes are narrower than a
 * session. The unit block pins the resolver, the second block drives the REAL
 * app so the wiring in jwt-auth.ts is covered too, and every refusal is paired
 * with a positive control so a harness that rejects everything cannot pass.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { app } from '../../../server/index';
import { jwtAuthMiddleware } from '../../../server/lib/middleware/jwt-auth';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';
import { makeExecutionContext } from '../helpers/exec-ctx';
import { createTestDb, setupSchema } from '../db';
import { toD1Binding } from '../helpers/d1-binding';
import * as schema from '../../../server/lib/db/schema';
import {
  resolveNativeToken, looksLikeOpaqueOAuthToken, isNativeProps, NATIVE_SCOPE, type NativeProps,
} from '../../../server/lib/auth/native-token';
import { MockKV } from '../mocks';
import { createHarness, INSPECTOR_ID, TENANT_ID, type Harness } from '../helpers/tenant-email-harness';

const TENANT = '00000000-0000-4000-8000-0000000000aa';
const USER = '00000000-0000-4000-8000-0000000000bb';
const ON = { NATIVE_CLIENT_ENABLED: 'true' };
const props: NativeProps = { kind: 'native', userId: USER, tenantId: TENANT, role: 'inspector', lastUsedAt: 0, grantedAt: 0 };

/** `tokenScope` is the access token's own scope; it defaults to the grant's. */
type GrantMap = Record<string, { scope: string[]; props: unknown; tokenScope?: string[] } | null>;

function provider(map: GrantMap) {
  return {
    unwrapToken: async (t: string) => {
      const g = map[t];
      return g ? { scope: g.tokenScope ?? g.scope, grant: { clientId: 'c', scope: g.scope, props: g.props } } : null;
    },
  };
}

async function unitEnv(deleted = false, role: 'owner' | 'manager' | 'inspector' | 'agent' = 'inspector') {
  const { sqlite } = createTestDb();
  await setupSchema(sqlite);
  const DB = toD1Binding(sqlite);
  const db = drizzle(DB);
  await db.insert(schema.tenants).values({
    id: TENANT, slug: 'native-unit', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
  });
  await db.insert(schema.users).values({
    id: USER, tenantId: TENANT, email: 'i@example.com', passwordHash: 'x', role,
    name: 'Native Inspector', createdAt: new Date(), deletedAt: deleted ? new Date() : null,
  });
  return DB;
}

describe('looksLikeOpaqueOAuthToken', () => {
  it('accepts userId:grantId:secret and rejects JWTs', () => {
    expect(looksLikeOpaqueOAuthToken('u:g:s')).toBe(true);
    expect(looksLikeOpaqueOAuthToken('aaa.bbb.ccc')).toBe(false);
    expect(looksLikeOpaqueOAuthToken('plain')).toBe(false);
  });
});

describe('isNativeProps', () => {
  it('requires lastUsedAt to be a number', () => {
    expect(isNativeProps(props)).toBe(true);
    expect(isNativeProps({ ...props, lastUsedAt: '0' })).toBe(false);
    expect(isNativeProps({ ...props, lastUsedAt: undefined })).toBe(false);
  });
});

describe('isNativeProps, grantedAt', () => {
  it('requires grantedAt to be a number', () => {
    expect(isNativeProps({ ...props, grantedAt: '0' })).toBe(false);
    expect(isNativeProps({ ...props, grantedAt: undefined })).toBe(false);
  });
});

describe('resolveNativeToken and the pwchanged marker', () => {
  const NOW = Math.floor(Date.now() / 1000);
  async function resolveWith(marker: string | null, grantedAt: number, kvThrows = false) {
    const DB = await unitEnv();
    const kv = new MockKV();
    if (marker !== null) await kv.put(`pwchanged:${USER}`, marker);
    if (kvThrows) kv.get.mockRejectedValue(new Error('kv down'));
    const OAUTH_PROVIDER = provider({ 'u:g:s': { scope: [NATIVE_SCOPE], props: { ...props, grantedAt } } });
    return resolveNativeToken({ DB, OAUTH_PROVIDER, TENANT_CACHE: kv as unknown as KVNamespace, ...ON }, 'u:g:s');
  }
  it('refuses a grant made before the credential change', async () => {
    expect(await resolveWith(String(NOW), NOW - 600)).toBeNull();
  });
  it('accepts a grant made after the credential change (the member signed in again)', async () => {
    expect((await resolveWith(String(NOW - 600), NOW))?.userId).toBe(USER);
  });
  it('accepts any grant when no marker exists', async () => {
    expect((await resolveWith(null, NOW - 600))?.userId).toBe(USER);
  });
  it('fails closed when the marker cannot be read, like the session path', async () => {
    expect(await resolveWith(null, NOW, true)).toBeNull();
  });
  it('skips the check when no KV is bound, like the session path', async () => {
    const DB = await unitEnv();
    const OAUTH_PROVIDER = provider({ 'u:g:s': { scope: [NATIVE_SCOPE], props } });
    expect((await resolveNativeToken({ DB, OAUTH_PROVIDER, ...ON }, 'u:g:s'))?.userId).toBe(USER);
  });
});

describe('resolveNativeToken', () => {
  it('resolves an active member holding a native grant (positive control)', async () => {
    const DB = await unitEnv();
    const OAUTH_PROVIDER = provider({ 'u:g:s': { scope: [NATIVE_SCOPE], props } });
    expect(await resolveNativeToken({ DB, OAUTH_PROVIDER, ...ON }, 'u:g:s')).toEqual(props);
  });
  it('rejects an MCP grant that lacks the native scope', async () => {
    const DB = await unitEnv();
    const OAUTH_PROVIDER = provider({ 'u:g:s': { scope: ['read:*', 'write:*'], props } });
    expect(await resolveNativeToken({ DB, OAUTH_PROVIDER, ...ON }, 'u:g:s')).toBeNull();
  });
  it('rejects a removed member even if the grant still exists', async () => {
    const DB = await unitEnv(true);
    const OAUTH_PROVIDER = provider({ 'u:g:s': { scope: [NATIVE_SCOPE], props } });
    expect(await resolveNativeToken({ DB, OAUTH_PROVIDER, ...ON }, 'u:g:s')).toBeNull();
  });
  it('takes the role from the users row, not from the grant props', async () => {
    const DB = await unitEnv(false, 'inspector');
    const stale: NativeProps = { ...props, role: 'manager' };
    const OAUTH_PROVIDER = provider({ 'u:g:s': { scope: [NATIVE_SCOPE], props: stale } });
    expect((await resolveNativeToken({ DB, OAUTH_PROVIDER, ...ON }, 'u:g:s'))?.role).toBe('inspector');
  });
  it('keeps a role the row still holds (positive control for the demotion case)', async () => {
    const DB = await unitEnv(false, 'manager');
    const OAUTH_PROVIDER = provider({ 'u:g:s': { scope: [NATIVE_SCOPE], props: { ...props, role: 'manager' } } });
    expect((await resolveNativeToken({ DB, OAUTH_PROVIDER, ...ON }, 'u:g:s'))?.role).toBe('manager');
  });
  it('rejects a user whose current role is not a native role', async () => {
    const DB = await unitEnv(false, 'agent');
    const OAUTH_PROVIDER = provider({ 'u:g:s': { scope: [NATIVE_SCOPE], props } });
    expect(await resolveNativeToken({ DB, OAUTH_PROVIDER, ...ON }, 'u:g:s')).toBeNull();
  });
  it('rejects a token whose own scope was narrowed below native', async () => {
    const DB = await unitEnv();
    const OAUTH_PROVIDER = provider({
      'u:narrow:s': { scope: [NATIVE_SCOPE], tokenScope: ['read:*'], props },
      'u:g:s': { scope: [NATIVE_SCOPE], tokenScope: [NATIVE_SCOPE], props },
    });
    expect(await resolveNativeToken({ DB, OAUTH_PROVIDER, ...ON }, 'u:narrow:s')).toBeNull();
    expect(await resolveNativeToken({ DB, OAUTH_PROVIDER, ...ON }, 'u:g:s')).toEqual(props);
  });
  it('rejects a grant whose props are not native props', async () => {
    const DB = await unitEnv();
    const OAUTH_PROVIDER = provider({ 'u:g:s': { scope: [NATIVE_SCOPE], props: { kind: 'mcp' } } });
    expect(await resolveNativeToken({ DB, OAUTH_PROVIDER, ...ON }, 'u:g:s')).toBeNull();
  });
  it('rejects an unknown or expired token', async () => {
    const DB = await unitEnv();
    expect(await resolveNativeToken({ DB, OAUTH_PROVIDER: provider({}), ...ON }, 'u:g:s')).toBeNull();
  });
  it('returns null when NATIVE_CLIENT_ENABLED is off, and resolves once it is on', async () => {
    const DB = await unitEnv();
    const OAUTH_PROVIDER = provider({ 'u:g:s': { scope: [NATIVE_SCOPE], props } });
    expect(await resolveNativeToken({ DB, OAUTH_PROVIDER }, 'u:g:s')).toBeNull();
    expect(await resolveNativeToken({ DB, OAUTH_PROVIDER, NATIVE_CLIENT_ENABLED: '0' }, 'u:g:s')).toBeNull();
    expect(await resolveNativeToken({ DB, OAUTH_PROVIDER, NATIVE_CLIENT_ENABLED: 'true' }, 'u:g:s')).toEqual(props);
  });
  it('returns null when the provider is not mounted', async () => {
    const DB = await unitEnv();
    expect(await resolveNativeToken({ DB, ...ON }, 'u:g:s')).toBeNull();
  });
});

describe('GET /api/session/context with an OAuth access token (real app)', () => {
  let h: Harness | undefined;
  afterEach(() => { h?.close(); h = undefined; });

  const nativeProps: NativeProps = {
    kind: 'native', userId: INSPECTOR_ID, tenantId: TENANT_ID, role: 'inspector', lastUsedAt: 0, grantedAt: 0,
  };

  async function get(harness: Harness, grants: GrantMap, token: string): Promise<Response> {
    const env = { ...harness.env, NATIVE_CLIENT_ENABLED: 'true', OAUTH_PROVIDER: provider(grants) } as typeof harness.env;
    const exec = makeExecutionContext({ label: 'session-context' });
    const res = await app.request('/api/session/context', { headers: { authorization: `Bearer ${token}` } }, env, exec.ctx);
    await exec.settle();
    return res;
  }

  it('answers 200 for a native grant (positive control)', async () => {
    h = await createHarness('standalone');
    const res = await get(h, { 'u:g:s': { scope: [NATIVE_SCOPE], props: nativeProps } }, 'u:g:s');
    expect(res.status, await res.clone().text()).toBe(200);
  });

  it('answers 401 for an MCP-scope grant presented to /api/*', async () => {
    h = await createHarness('standalone');
    const grants: GrantMap = {
      'u:mcp:s': { scope: ['read:*', 'write:*'], props: nativeProps },
      'u:g:s': { scope: [NATIVE_SCOPE], props: nativeProps },
    };
    expect((await get(h, grants, 'u:mcp:s')).status).toBe(401);
    expect((await get(h, grants, 'u:g:s')).status).toBe(200);
  });

  it('answers 401 once the member is removed, while the grant still resolves', async () => {
    h = await createHarness('standalone');
    const grants: GrantMap = { 'u:g:s': { scope: [NATIVE_SCOPE], props: nativeProps } };
    expect((await get(h, grants, 'u:g:s')).status).toBe(200);
    await h.db.update(schema.users).set({ deletedAt: new Date() }).where(eq(schema.users.id, INSPECTOR_ID));
    expect((await get(h, grants, 'u:g:s')).status).toBe(401);
  });

  it('answers 401 for a token narrowed below native, 200 for the full one', async () => {
    h = await createHarness('standalone');
    const grants: GrantMap = {
      'u:narrow:s': { scope: [NATIVE_SCOPE], tokenScope: ['read:*'], props: nativeProps },
      'u:g:s': { scope: [NATIVE_SCOPE], props: nativeProps },
    };
    expect((await get(h, grants, 'u:narrow:s')).status).toBe(401);
    expect((await get(h, grants, 'u:g:s')).status).toBe(200);
  });

  it('answers 401 for a valid native grant when NATIVE_CLIENT_ENABLED is unset', async () => {
    h = await createHarness('standalone');
    const grants: GrantMap = { 'u:g:s': { scope: [NATIVE_SCOPE], props: nativeProps } };
    const off = { ...h.env, OAUTH_PROVIDER: provider(grants) } as typeof h.env;
    const exec = makeExecutionContext({ label: 'session-context-off' });
    const res = await app.request('/api/session/context', { headers: { authorization: 'Bearer u:g:s' } }, off, exec.ctx);
    await exec.settle();
    expect(res.status).toBe(401);
    expect((await get(h, grants, 'u:g:s')).status).toBe(200);
  });

  it('answers 401 for an unknown opaque token', async () => {
    h = await createHarness('standalone');
    expect((await get(h, {}, 'u:g:s')).status).toBe(401);
  });
});

describe('SaaS tenant isolation guard with a native token', () => {
  let h: Harness | undefined;
  afterEach(() => { h?.close(); h = undefined; });

  const OTHER_TENANT = '11111111-0000-4000-8000-0000000000ff';
  const nativeProps: NativeProps = {
    kind: 'native', userId: INSPECTOR_ID, tenantId: TENANT_ID, role: 'inspector', lastUsedAt: 0, grantedAt: 0,
  };

  /**
   * Host-based tenant resolution is retired, and the only routes that set
   * `resolvedTenantId` (public slug and inspection-id paths) are skipped by
   * jwtAuth, so no real route reaches the guard with both ids set. The guard is
   * still a fail-closed backstop, so it is driven here through the real
   * middleware with the resolved tenant set the way tenantRouter would set it.
   */
  async function getResolvedAs(harness: Harness, resolvedTenantId: string): Promise<Response> {
    const probe = new Hono<HonoConfig>();
    probe.use('*', async (c, next) => {
      c.set('profile', { mode: 'saas' } as HonoConfig['Variables']['profile']);
      c.set('resolvedTenantId', resolvedTenantId);
      await next();
    });
    probe.use('*', jwtAuthMiddleware);
    probe.onError((err, c) => (err instanceof AppError ? c.json({ error: err.message }, err.status) : c.text('boom', 500)));
    probe.get('/api/probe', (c) => c.json({ tenantId: c.get('tenantId') }));
    const env = {
      ...harness.env,
      NATIVE_CLIENT_ENABLED: 'true',
      OAUTH_PROVIDER: provider({ 'u:g:s': { scope: [NATIVE_SCOPE], props: nativeProps } }),
    } as typeof harness.env;
    const exec = makeExecutionContext({ label: 'saas-guard' });
    const res = await probe.request('/api/probe', { headers: { authorization: 'Bearer u:g:s' } }, env, exec.ctx);
    await exec.settle();
    return res;
  }

  it('answers 403 when the token tenant differs from the resolved tenant', async () => {
    h = await createHarness('saas');
    const res = await getResolvedAs(h, OTHER_TENANT);
    expect(res.status, await res.clone().text()).toBe(403);
  });

  it('answers 200 when the token tenant is the resolved tenant (positive control)', async () => {
    h = await createHarness('saas');
    const res = await getResolvedAs(h, TENANT_ID);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await res.json()).toEqual({ tenantId: TENANT_ID });
  });
});
