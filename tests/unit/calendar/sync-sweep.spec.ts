import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb, setupSchema, toRawD1 } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', async (orig) => ({
    ...(await orig<Record<string, unknown>>()),
    drizzle: vi.fn(),
}));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const importBusy = vi.fn();
vi.mock('../../../server/lib/calendar/sync-engine', () => ({
    importBusyForConnection: (...a: unknown[]) => importBusy(...a),
}));

const openConn = vi.fn();
vi.mock('../../../server/lib/calendar/connection', async (orig) => ({
    ...(await orig<Record<string, unknown>>()),
    loadOpenGoogleConnection: (...a: unknown[]) => openConn(...a),
}));

vi.mock('../../../server/lib/calendar/resolve-google-oauth', () => ({
    loadGoogleOAuthMode: async () => 'platform',
    resolveGoogleOAuthCredentials: async () => ({ clientId: 'cid', clientSecret: 'sec' }),
}));

import {
    sweepCalendarSyncs,
    SYNC_INTERVAL_MS,
    MAX_CONNECTIONS_PER_TICK,
} from '../../../server/lib/calendar/sync-sweep';

const TENANT = '00000000-0000-0000-0000-000000000001';
const NOW = Date.UTC(2026, 5, 1, 12, 0);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

describe('sweepCalendarSyncs', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];
    let env: Parameters<typeof sweepCalendarSyncs>[0];

    async function addConnection(id: string, userId: string, lastSyncAt: Date | null) {
        await db.insert(schema.calendarConnections).values({
            id, tenantId: TENANT, userId, provider: 'google', authType: 'oauth',
            credentialsEnc: 'x', credentialsDekEnc: 'x',
            capabilities: 'events_read_write', calendarId: 'primary',
            connectedAt: new Date(NOW - 90 * 60 * 1000),
            updatedAt: new Date(NOW - 90 * 60 * 1000),
            lastSyncAt,
        });
    }

    const rows = () => db.select().from(schema.calendarConnections).all();

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        sqlite = fixture.sqlite;
        await setupSchema(sqlite);
        await db.insert(schema.tenants).values({
            id: TENANT, name: 'A', slug: 'a', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(db);
        env = {
            DB: toRawD1(sqlite),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            TENANT_CACHE: {} as any,
            JWT_SECRET: 's',
        };
        importBusy.mockReset().mockResolvedValue({ upserted: 1, totalEvents: 1, skipped: {} });
        openConn.mockReset().mockResolvedValue({
            connection: { id: 'c1', tenantId: TENANT, userId: 'u1', calendarId: 'primary', capabilities: 'events_read_write' },
            credentials: { refreshToken: 'rt' },
        });
    });

    afterEach(() => { sqlite.close(); vi.clearAllMocks(); });

    it('syncs a connection that has never synced', async () => {
        await addConnection('c1', 'u1', null);
        const out = await sweepCalendarSyncs(env, NOW);
        expect(out).toMatchObject({ attempted: 1, succeeded: 1, failed: 0 });
        expect(importBusy).toHaveBeenCalledTimes(1);
    });

    it('leaves a connection synced inside the interval alone', async () => {
        await addConnection('c1', 'u1', new Date(NOW - SYNC_INTERVAL_MS + 60_000));
        const out = await sweepCalendarSyncs(env, NOW);
        expect(out.attempted).toBe(0);
        expect(importBusy).not.toHaveBeenCalled();
    });

    it('picks up a connection once the interval has elapsed', async () => {
        await addConnection('c1', 'u1', new Date(NOW - SYNC_INTERVAL_MS - 1));
        expect((await sweepCalendarSyncs(env, NOW)).attempted).toBe(1);
    });

    it('stamps lastSyncAt and clears any previous error on success', async () => {
        await addConnection('c1', 'u1', null);
        await db.update(schema.calendarConnections).set({ lastSyncError: 'token revoked' });

        await sweepCalendarSyncs(env, NOW);
        const row = (await rows())[0]!;
        expect(row.lastSyncError).toBeNull();
        expect(row.lastSyncAt).not.toBeNull();
    });

    /**
     * The reason last_sync_error exists. A stale badge alone cannot say whether
     * nothing changed or nobody could reach Google.
     */
    it('records the provider reason on failure', async () => {
        await addConnection('c1', 'u1', null);
        importBusy.mockRejectedValueOnce(new Error('invalid_grant: token has been revoked'));

        const out = await sweepCalendarSyncs(env, NOW);
        expect(out).toMatchObject({ attempted: 1, succeeded: 0, failed: 1 });
        expect((await rows())[0]!.lastSyncError).toContain('invalid_grant');
    });

    /**
     * lastSyncAt vouches for data we actually hold. A failed attempt refreshed
     * nothing, so it must not be allowed to look fresh.
     */
    it('does not advance lastSyncAt when the sync failed', async () => {
        const stamp = new Date(NOW - 2 * SYNC_INTERVAL_MS);
        await addConnection('c1', 'u1', stamp);
        importBusy.mockRejectedValueOnce(new Error('boom'));

        await sweepCalendarSyncs(env, NOW);
        expect((await rows())[0]!.lastSyncAt?.getTime()).toBe(stamp.getTime());
    });

    /** One tenant's broken token must not stop the rest of the sweep. */
    it('keeps going after one connection throws', async () => {
        await addConnection('c1', 'u1', null);
        await addConnection('c2', 'u2', null);
        importBusy.mockRejectedValueOnce(new Error('boom'));

        const out = await sweepCalendarSyncs(env, NOW);
        expect(out).toMatchObject({ attempted: 2, succeeded: 1, failed: 1 });
    });

    it('flags a connection whose credentials no longer decrypt instead of retrying blindly', async () => {
        await addConnection('c1', 'u1', null);
        openConn.mockResolvedValueOnce(null);

        const out = await sweepCalendarSyncs(env, NOW);
        expect(out).toMatchObject({ succeeded: 0, failed: 1 });
        expect((await rows())[0]!.lastSyncError).toMatch(/Reconnect Google Calendar/);
        expect(importBusy).not.toHaveBeenCalled();
    });

    it('caps how many connections one tick may take', async () => {
        for (let i = 0; i < MAX_CONNECTIONS_PER_TICK + 5; i++) {
            await addConnection(`c${i}`, `u${i}`, null);
        }
        const out = await sweepCalendarSyncs(env, NOW);
        expect(out.attempted).toBe(MAX_CONNECTIONS_PER_TICK);
    });

    /** Stalest-first is the fairness mechanism; without it the cap starves rows. */
    it('takes the stalest connections first', async () => {
        await addConnection('fresh', 'u1', new Date(NOW - SYNC_INTERVAL_MS - 1000));
        await addConnection('stale', 'u2', new Date(NOW - 10 * SYNC_INTERVAL_MS));
        await addConnection('never', 'u3', null);

        await sweepCalendarSyncs(env, NOW);
        const order = openConn.mock.calls.map((c) => c[2]);
        expect(order).toEqual(['u3', 'u2', 'u1']);
    });
});
