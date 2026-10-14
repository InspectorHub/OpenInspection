/**
 * Which native app versions a company's devices have been seen running
 * (`native_client_seen`), written from `GET /api/client/session` through the
 * REAL app. Every "does not write" case is paired with a case that does, so a
 * harness that never writes cannot pass.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { and, eq, getTableName } from 'drizzle-orm';
import { app } from '../../../server/index';
import { makeExecutionContext } from '../helpers/exec-ctx';
import * as schema from '../../../server/lib/db/schema';
import { NATIVE_SCOPE, type NativeProps } from '../../../server/lib/auth/native-token';
import { NATIVE_SEEN_MAX_ROWS_PER_TENANT, NATIVE_SEEN_REFRESH_MS } from '../../../server/services/native-client-seen';
import { tenantScopedTables } from '../../../server/lib/db/scoped-tables';
import { createHarness, INSPECTOR_ID, TENANT_ID, type Harness } from '../helpers/tenant-email-harness';

const OTHER_TENANT = '11111111-0000-4000-8000-0000000000ff';
const OTHER_USER = '22222222-0000-4000-8000-0000000000ff';

const props = (userId: string, tenantId: string): NativeProps => ({
  kind: 'native', userId, tenantId, role: 'inspector', lastUsedAt: 0, grantedAt: 0,
});
const grants: Record<string, NativeProps> = {
  'u:g:s': props(INSPECTOR_ID, TENANT_ID),
  'o:g:s': props(OTHER_USER, OTHER_TENANT),
};
const provider = {
  unwrapToken: async (t: string) => {
    const p = grants[t];
    return p ? { scope: [NATIVE_SCOPE], grant: { clientId: 'c', scope: [NATIVE_SCOPE], props: p } } : null;
  },
};

describe('native_client_seen (real app)', () => {
  let h: Harness | undefined;
  afterEach(() => { vi.useRealTimers(); h?.close(); h = undefined; });

  async function ensureHarness(): Promise<Harness> {
    if (h) return h;
    h = await createHarness('standalone');
    await h.db.insert(schema.tenants).values({
      id: OTHER_TENANT, slug: 'other-seen', status: 'active', tier: 'free', deploymentMode: 'shared', createdAt: new Date(),
    });
    await h.db.insert(schema.users).values({
      id: OTHER_USER, tenantId: OTHER_TENANT, email: 'o@example.com', passwordHash: 'x', role: 'inspector',
      name: 'Other', createdAt: new Date(),
    });
    return h;
  }

  async function session(headers: Record<string, string>, auth = 'u:g:s'): Promise<Response> {
    const harness = await ensureHarness();
    const env = { ...harness.env, NATIVE_CLIENT_ENABLED: 'true', OAUTH_PROVIDER: provider } as typeof harness.env;
    const exec = makeExecutionContext({ label: 'client-seen' });
    const res = await app.request('/api/client/session', { headers: { authorization: `Bearer ${auth}`, ...headers } }, env, exec.ctx);
    await exec.settle();
    expect(res.status, await res.clone().text()).toBe(200);
    return res;
  }
  const rows = (tenantId = TENANT_ID) =>
    h!.db.select().from(schema.nativeClientSeen).where(eq(schema.nativeClientSeen.tenantId, tenantId)).all();
  const ios = (version: string) => ({ 'X-Client-Platform': 'ios', 'X-Client-Version': version });

  it('records the first sighting of a version, in normalized form', async () => {
    await session(ios('1.4'));
    const [row, ...rest] = await rows();
    expect(rest).toEqual([]);
    expect(row).toMatchObject({ tenantId: TENANT_ID, platform: 'ios', clientVersion: '1.4.0' });
    expect(row!.firstSeenAt.getTime()).toBe(row!.lastSeenAt.getTime());
  });

  it('does not write again inside the hour, and updates last_seen_at after it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = Date.now();
    await session(ios('1.4.0'));
    const first = (await rows())[0]!;

    vi.setSystemTime(start + NATIVE_SEEN_REFRESH_MS - 1000);
    await session(ios('1.4.0'));
    expect((await rows())[0]!.lastSeenAt.getTime()).toBe(first.lastSeenAt.getTime());

    vi.setSystemTime(start + NATIVE_SEEN_REFRESH_MS + 1000);
    await session(ios('1.4.0'));
    const after = await rows();
    expect(after).toHaveLength(1);
    expect(after[0]!.lastSeenAt.getTime()).toBe(start + NATIVE_SEEN_REFRESH_MS + 1000);
    expect(after[0]!.firstSeenAt.getTime()).toBe(first.firstSeenAt.getTime());
  });

  it('keeps a row per platform and per version', async () => {
    await session(ios('1.4.0'));
    await session(ios('1.5.0'));
    await session({ 'X-Client-Platform': 'android', 'X-Client-Version': '1.4.0' });
    expect((await rows()).map((r) => `${r.platform}:${r.clientVersion}`).sort()).toEqual(['android:1.4.0', 'ios:1.4.0', 'ios:1.5.0']);
  });

  it('writes nothing for a missing or unknown platform or an unusable version', async () => {
    const bad: Record<string, string>[] = [
      {},
      { 'X-Client-Version': '1.4.0' },
      { 'X-Client-Platform': 'ios' },
      { 'X-Client-Platform': 'palmos', 'X-Client-Version': '1.4.0' },
      ios('1.4.0-beta'),
      ios('v1.4'),
      ios('1.2.3.4'),
      ios('1'.repeat(40)),
      ios('1.0; DROP TABLE users;--'),
      ios(''),
    ];
    for (const headers of bad) await session(headers);
    expect(await rows()).toEqual([]);
    // Control: a valid pair on the same harness is recorded.
    await session(ios('2.0.0'));
    expect(await rows()).toHaveLength(1);
  });

  it('keeps companies apart', async () => {
    await session(ios('1.4.0'));
    await session(ios('1.9.0'), 'o:g:s');
    expect((await rows(TENANT_ID)).map((r) => r.clientVersion)).toEqual(['1.4.0']);
    expect((await rows(OTHER_TENANT)).map((r) => r.clientVersion)).toEqual(['1.9.0']);
  });

  it('stops adding versions at the per-company cap but still refreshes the ones it holds', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = Date.now();
    await session(ios('9.9.9'));
    await h!.db.insert(schema.nativeClientSeen).values(
      Array.from({ length: NATIVE_SEEN_MAX_ROWS_PER_TENANT - 1 }, (_, i) => ({
        tenantId: TENANT_ID, platform: 'android' as const, clientVersion: `5.0.${i}`, firstSeenAt: new Date(start), lastSeenAt: new Date(start),
      })),
    );
    expect(await rows()).toHaveLength(NATIVE_SEEN_MAX_ROWS_PER_TENANT);

    await session({ 'X-Client-Platform': 'android', 'X-Client-Version': '7.7.7' });
    const full = await rows();
    expect(full).toHaveLength(NATIVE_SEEN_MAX_ROWS_PER_TENANT);
    expect(full.some((r) => r.clientVersion === '7.7.7')).toBe(false);

    // An existing version is still updated at the cap.
    vi.setSystemTime(start + NATIVE_SEEN_REFRESH_MS + 1000);
    await session(ios('9.9.9'));
    const kept = await h!.db.select().from(schema.nativeClientSeen)
      .where(and(eq(schema.nativeClientSeen.tenantId, TENANT_ID), eq(schema.nativeClientSeen.clientVersion, '9.9.9'))).get();
    expect(kept!.lastSeenAt.getTime()).toBe(start + NATIVE_SEEN_REFRESH_MS + 1000);
    // Another company is not held back by this one's cap.
    await session(ios('1.9.0'), 'o:g:s');
    expect(await rows(OTHER_TENANT)).toHaveLength(1);
  });

  it('never fails the session call when the write cannot happen', async () => {
    const harness = await ensureHarness();
    harness.sqlite.exec('DROP TABLE native_client_seen');
    const res = await session(ios('1.4.0'));
    expect(res.status).toBe(200);
  });

  it('is among the tables a tenant purge clears', () => {
    expect(tenantScopedTables().map((t) => getTableName(t))).toContain('native_client_seen');
  });
});
