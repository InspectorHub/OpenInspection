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
import { drizzle } from 'drizzle-orm/d1';
import { app } from '../../../server/index';
import { makeExecutionContext } from '../helpers/exec-ctx';
import { createTestDb, setupSchema } from '../db';
import { toD1Binding } from '../helpers/d1-binding';
import * as schema from '../../../server/lib/db/schema';
import {
  resolveNativeToken, looksLikeOpaqueOAuthToken, isNativeProps, NATIVE_SCOPE, type NativeProps,
} from '../../../server/lib/auth/native-token';
import { createHarness, INSPECTOR_ID, TENANT_ID, type Harness } from '../helpers/tenant-email-harness';

const TENANT = '00000000-0000-4000-8000-0000000000aa';
const USER = '00000000-0000-4000-8000-0000000000bb';
const props: NativeProps = { kind: 'native', userId: USER, tenantId: TENANT, role: 'inspector', lastUsedAt: 0 };

type GrantMap = Record<string, { scope: string[]; props: unknown } | null>;

function provider(map: GrantMap) {
  return {
    unwrapToken: async (t: string) => {
      const g = map[t];
      return g ? { grant: { clientId: 'c', ...g } } : null;
    },
  };
}

async function unitEnv(deleted = false) {
  const { sqlite } = createTestDb();
  await setupSchema(sqlite);
  const DB = toD1Binding(sqlite);
  const db = drizzle(DB);
  await db.insert(schema.tenants).values({
    id: TENANT, slug: 'native-unit', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
  });
  await db.insert(schema.users).values({
    id: USER, tenantId: TENANT, email: 'i@example.com', passwordHash: 'x', role: 'inspector',
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

describe('resolveNativeToken', () => {
  it('resolves an active member holding a native grant (positive control)', async () => {
    const DB = await unitEnv();
    const OAUTH_PROVIDER = provider({ 'u:g:s': { scope: [NATIVE_SCOPE], props } });
    expect(await resolveNativeToken({ DB, OAUTH_PROVIDER }, 'u:g:s')).toEqual(props);
  });
  it('rejects an MCP grant that lacks the native scope', async () => {
    const DB = await unitEnv();
    const OAUTH_PROVIDER = provider({ 'u:g:s': { scope: ['read:*', 'write:*'], props } });
    expect(await resolveNativeToken({ DB, OAUTH_PROVIDER }, 'u:g:s')).toBeNull();
  });
  it('rejects a removed member even if the grant still exists', async () => {
    const DB = await unitEnv(true);
    const OAUTH_PROVIDER = provider({ 'u:g:s': { scope: [NATIVE_SCOPE], props } });
    expect(await resolveNativeToken({ DB, OAUTH_PROVIDER }, 'u:g:s')).toBeNull();
  });
  it('rejects a grant whose props are not native props', async () => {
    const DB = await unitEnv();
    const OAUTH_PROVIDER = provider({ 'u:g:s': { scope: [NATIVE_SCOPE], props: { kind: 'mcp' } } });
    expect(await resolveNativeToken({ DB, OAUTH_PROVIDER }, 'u:g:s')).toBeNull();
  });
  it('rejects an unknown or expired token', async () => {
    const DB = await unitEnv();
    expect(await resolveNativeToken({ DB, OAUTH_PROVIDER: provider({}) }, 'u:g:s')).toBeNull();
  });
  it('returns null when the provider is not mounted', async () => {
    const DB = await unitEnv();
    expect(await resolveNativeToken({ DB }, 'u:g:s')).toBeNull();
  });
});

describe('GET /api/session/context with an OAuth access token (real app)', () => {
  let h: Harness | undefined;
  afterEach(() => { h?.close(); h = undefined; });

  const nativeProps: NativeProps = {
    kind: 'native', userId: INSPECTOR_ID, tenantId: TENANT_ID, role: 'inspector', lastUsedAt: 0,
  };

  async function get(harness: Harness, grants: GrantMap, token: string): Promise<Response> {
    const env = { ...harness.env, OAUTH_PROVIDER: provider(grants) } as typeof harness.env;
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

  it('answers 401 for an unknown opaque token', async () => {
    h = await createHarness('standalone');
    expect((await get(h, {}, 'u:g:s')).status).toBe(401);
  });
});
