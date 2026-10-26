/**
 * A password change, a reset and a self-delete write `pwchanged:{userId}`, which
 * cuts off session JWTs. A native client holds an OAuth grant instead, and the
 * resolver never reads that marker, so each of those paths must revoke the
 * user's grants as well. Every revocation is paired with a second user whose
 * grant must survive, so a revoke-everything bug cannot pass.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { AuthService } from '../../../server/services/auth.service';
import { softDeleteAccount } from '../../../server/services/account.service';
import { TeamService } from '../../../server/services/team.service';
import { hashPassword } from '../../../server/lib/password';
import { MockKV } from '../mocks';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = 't-native';
const ALICE = 'u-alice';
const BOB = 'u-bob';

/** In-memory stand-in for the provider's grant store: grantId -> owner. */
function fakeOauth(failList = false) {
  const grants = new Map<string, string>([['g-alice', ALICE], ['g-bob', BOB]]);
  const oauth = {
    listUserGrants: vi.fn(async (userId: string) => {
      if (failList) throw new Error('provider down');
      return { items: [...grants].filter(([, owner]) => owner === userId).map(([id]) => ({ id })) };
    }),
    revokeGrant: vi.fn(async (grantId: string) => { grants.delete(grantId); }),
  } as unknown as OAuthHelpers;
  return { oauth, grants };
}

describe('native grants are revoked wherever pwchanged is written', () => {
  let db: BetterSQLite3Database<typeof schema>;
  let sqlite: { close: () => void };
  let kv: MockKV;

  beforeEach(async () => {
    const setup = createTestDb();
    db = setup.db;
    sqlite = setup.sqlite;
    await setupSchema(setup.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    await db.insert(schema.tenants).values({ id: TENANT, slug: 'nat', createdAt: new Date() });
    const passwordHash = await hashPassword('old-pass');
    await db.insert(schema.users).values([
      { id: ALICE, tenantId: TENANT, email: 'alice@x.test', passwordHash, role: 'owner', createdAt: new Date() },
      { id: BOB, tenantId: TENANT, email: 'bob@x.test', passwordHash, role: 'owner', createdAt: new Date() },
    ]);
    kv = new MockKV();
  });
  afterEach(() => { sqlite.close(); vi.clearAllMocks(); });

  it('updatePassword revokes the caller\'s grants and leaves other users\' alone', async () => {
    const { oauth, grants } = fakeOauth();
    const svc = new AuthService({} as D1Database, kv as unknown as KVNamespace, undefined, oauth);
    await svc.updatePassword(ALICE, 'old-pass', 'new-pass-1');
    expect([...grants.keys()]).toEqual(['g-bob']);
  });

  it('resetPassword revokes the reset user\'s grants and leaves other users\' alone', async () => {
    const { oauth, grants } = fakeOauth();
    const svc = new AuthService({} as D1Database, kv as unknown as KVNamespace, undefined, oauth);
    await kv.put('pw_reset:tok', `${ALICE}:${Math.floor(Date.now() / 1000)}`);
    await svc.resetPassword('tok', 'new-pass-2');
    expect([...grants.keys()]).toEqual(['g-bob']);
  });

  it('a failing provider does not block the password change', async () => {
    const { oauth } = fakeOauth(true);
    const svc = new AuthService({} as D1Database, kv as unknown as KVNamespace, undefined, oauth);
    await expect(svc.updatePassword(ALICE, 'old-pass', 'new-pass-3')).resolves.toBeUndefined();
  });

  it('works without a provider (OAuth not mounted)', async () => {
    const svc = new AuthService({} as D1Database, kv as unknown as KVNamespace);
    await expect(svc.updatePassword(ALICE, 'old-pass', 'new-pass-4')).resolves.toBeUndefined();
  });

  it('softDeleteAccount revokes the deleted user\'s grants and leaves other users\' alone', async () => {
    const { oauth, grants } = fakeOauth();
    await softDeleteAccount(db as never, ALICE, 'alice@x.test', kv as unknown as KVNamespace, oauth);
    expect([...grants.keys()]).toEqual(['g-bob']);
  });

  describe('the reason a native session ended is recorded before the grant is revoked', () => {
    /** Alice holds one native grant and one MCP grant; Bob's native grant must stay unmarked. */
    function nativeOauth() {
      const grants = new Map<string, { owner: string; kind: string }>([
        ['g-alice-native', { owner: ALICE, kind: 'native' }], ['g-alice-mcp', { owner: ALICE, kind: 'mcp' }], ['g-bob-native', { owner: BOB, kind: 'native' }],
      ]);
      return {
        listUserGrants: vi.fn(async (userId: string) => ({ items: [...grants].filter(([, g]) => g.owner === userId).map(([id, g]) => ({ id, metadata: { kind: g.kind } })) })),
        revokeGrant: vi.fn(async (grantId: string) => { grants.delete(grantId); }),
      } as unknown as OAuthHelpers;
    }
    const markers = () => [...(kv as unknown as { store: Map<string, string> }).store].filter(([k]) => k.startsWith('native-end:'));

    it('removing a member marks the native grant of the removed member member_removed and nothing else', async () => {
      const team = new TeamService({} as D1Database, undefined, kv as unknown as KVNamespace, nativeOauth());
      await team.removeMember(TENANT, ALICE, BOB, 'owner');
      expect(markers()).toEqual([['native-end:g-alice-native', 'member_removed']]);
    });

    it('self-deleting an account marks the native grant member_removed', async () => {
      await softDeleteAccount(db as never, ALICE, 'alice@x.test', kv as unknown as KVNamespace, nativeOauth());
      expect(markers()).toEqual([['native-end:g-alice-native', 'member_removed']]);
    });

    it('CONTROL: a password change revokes the grant but records no reason', async () => {
      const svc = new AuthService({} as D1Database, kv as unknown as KVNamespace, undefined, nativeOauth());
      await svc.updatePassword(ALICE, 'old-pass', 'new-pass-5');
      expect(markers()).toEqual([]);
    });
  });
});
