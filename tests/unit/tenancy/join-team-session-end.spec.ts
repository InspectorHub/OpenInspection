/**
 * Re-inviting a removed member reactivates the row under the same user id, and the grants that id still holds
 * are revoked. A native grant revoked there must leave the `member_removed` reason, exactly as removal does,
 * so the app can tell the person why the session ended.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import { users, tenantInvites, tenants, tenantConfigs } from '../../../server/lib/db/schema';
import * as schema from '../../../server/lib/db/schema';
import { MockKV } from '../mocks';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { withBatch } from '../helpers/d1-binding';
import { AuthService } from '../../../server/services/auth.service';
import { SEAT_QUOTA_UNENFORCED } from '../../../server/features/seat-quota';
import { LegalVersionService } from '../../../server/services/legal-version.service';

const MEMBER = 'u-removed';

describe('joinTeam records why a native session ended', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let sqlite: { close: () => void };
    let kv: MockKV;

    beforeEach(async () => {
        const setup = createTestDb();
        testDb = setup.db;
        sqlite = setup.sqlite;
        await setupSchema(setup.sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(withBatch(testDb, setup.sqlite));
        await testDb.insert(tenants).values({ id: 't1', slug: 'test', createdAt: new Date() });
        await testDb.insert(tenantConfigs).values({ tenantId: 't1', companyName: 'Test Tenant', updatedAt: new Date() });
        const legal = new LegalVersionService(testDb as never);
        await legal.recordPublish({ tenantId: 't1', doc: 'terms', body: 'Terms.', timezone: 'UTC' });
        await legal.recordPublish({ tenantId: 't1', doc: 'privacy', body: 'Privacy.', timezone: 'UTC' });
        kv = new MockKV();
    });
    afterEach(() => { sqlite.close(); vi.clearAllMocks(); });

    const markers = () => [...(kv as unknown as { store: Map<string, string> }).store].filter(([k]) => k.startsWith('native-end:'));

    function oauthWith(grants: [string, string][]) {
        const held = new Map(grants);
        return {
            listUserGrants: vi.fn(async () => ({ items: [...held].map(([id, kind]) => ({ id, metadata: { kind } })) })),
            revokeGrant: vi.fn(async (id: string) => { held.delete(id); }),
        } as unknown as OAuthHelpers;
    }

    async function invite(removed: boolean) {
        if (removed) {
            await testDb.insert(users).values({
                id: MEMBER, tenantId: 't1', email: 'back@example.com', passwordHash: 'x', role: 'inspector',
                createdAt: new Date(), deletedAt: new Date(),
            });
        }
        await testDb.insert(tenantInvites).values({
            id: 'tok', tenantId: 't1', email: 'back@example.com', role: 'inspector',
            status: 'pending', expiresAt: new Date(Date.now() + 1_000_000), invitedBy: 'u1',
        } as never);
    }
    const join = (auth: AuthService) => auth.joinTeam('tok', 'password123', { seatQuota: SEAT_QUOTA_UNENFORCED });

    it('marks the native grant of a re-invited member member_removed', async () => {
        await invite(true);
        const oauth = oauthWith([['g-native', 'native']]);
        await join(new AuthService({} as D1Database, kv as unknown as KVNamespace, undefined, oauth));
        expect(oauth.revokeGrant).toHaveBeenCalledWith('g-native', MEMBER);
        expect(markers()).toEqual([['native-end:g-native', 'member_removed']]);
    });

    it('CONTROL: an MCP grant is revoked but not marked', async () => {
        await invite(true);
        const oauth = oauthWith([['g-mcp', 'mcp']]);
        await join(new AuthService({} as D1Database, kv as unknown as KVNamespace, undefined, oauth));
        expect(oauth.revokeGrant).toHaveBeenCalledWith('g-mcp', MEMBER);
        expect(markers()).toEqual([]);
    });

    it('CONTROL: a fresh join with no earlier row revokes nothing and writes no marker', async () => {
        await invite(false);
        const oauth = oauthWith([['g-native', 'native']]);
        await join(new AuthService({} as D1Database, kv as unknown as KVNamespace, undefined, oauth));
        expect(oauth.revokeGrant).not.toHaveBeenCalled();
        expect(markers()).toEqual([]);
    });

    it('CONTROL: a failing KV does not block the join, and the grant is still revoked', async () => {
        await invite(true);
        const oauth = oauthWith([['g-native', 'native']]);
        const failing = { put: vi.fn(async () => { throw new Error('kv down'); }), get: vi.fn(async () => null) } as unknown as KVNamespace;
        const user = await join(new AuthService({} as D1Database, failing, undefined, oauth));
        expect(user.id).toBe(MEMBER);
        expect(oauth.revokeGrant).toHaveBeenCalledWith('g-native', MEMBER);
    });
});
