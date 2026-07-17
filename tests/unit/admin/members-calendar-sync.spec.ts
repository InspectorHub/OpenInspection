import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AdminService } from '../../../server/services/admin.service';
import { MockKV } from '../mocks';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';

vi.mock('drizzle-orm/d1', () => ({
    drizzle: vi.fn(),
}));

import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = 't1';
const OTHER_TENANT = 't2';
const SYNCED = 'user-synced';
const NEVER_SYNCED = 'user-never-synced';
const UNCONNECTED = 'user-unconnected';
const LAST_SYNC = new Date('2026-08-03T10:00:00.000Z');

function connection(id: string, tenantId: string, userId: string, lastSyncAt: Date | null) {
    return {
        id,
        tenantId,
        userId,
        provider: 'google' as const,
        authType: 'oauth' as const,
        credentialsEnc: 'enc',
        credentialsDekEnc: 'dek',
        capabilities: 'availability_read' as const,
        calendarId: 'primary',
        connectedAt: new Date('2026-08-01T00:00:00.000Z'),
        updatedAt: new Date('2026-08-01T00:00:00.000Z'),
        lastSyncAt,
    };
}

describe('AdminService.getMembers — calendar sync metadata', () => {
    let adminService: AdminService;
    let testDb: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];

    beforeEach(async () => {
        const setup = createTestDb();
        testDb = setup.db;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);
        (mockDrizzle as ReturnType<typeof vi.fn>).mockReturnValue(testDb);

        await testDb.insert(schema.tenants).values([
            { id: TENANT, name: 'Acme', slug: 'acme', createdAt: new Date() },
            { id: OTHER_TENANT, name: 'Other', slug: 'other', createdAt: new Date() },
        ]);
        await testDb.insert(schema.users).values([
            { id: SYNCED, tenantId: TENANT, email: 'a@acme.com', passwordHash: 'h', role: 'inspector', createdAt: new Date() },
            { id: NEVER_SYNCED, tenantId: TENANT, email: 'b@acme.com', passwordHash: 'h', role: 'inspector', createdAt: new Date() },
            { id: UNCONNECTED, tenantId: TENANT, email: 'c@acme.com', passwordHash: 'h', role: 'inspector', createdAt: new Date() },
        ]);
        await testDb.insert(schema.calendarConnections).values([
            connection('conn-1', TENANT, SYNCED, LAST_SYNC),
            connection('conn-2', TENANT, NEVER_SYNCED, null),
        ]);

        adminService = new AdminService({} as unknown as D1Database, new MockKV() as unknown as KVNamespace);
    });

    afterEach(() => sqlite.close());

    async function membersById() {
        const { members } = await adminService.getMembers(TENANT);
        return new Map(members.map((m) => [m.id, m]));
    }

    it('reports a synced connection with its epoch-ms timestamp', async () => {
        const m = (await membersById()).get(SYNCED);
        expect(m?.calendarConnected).toBe(true);
        expect(m?.calendarLastSyncAt).toBe(LAST_SYNC.getTime());
    });

    it('reports a connected but never-synced inspector as connected with no timestamp', async () => {
        const m = (await membersById()).get(NEVER_SYNCED);
        expect(m?.calendarConnected).toBe(true);
        expect(m?.calendarLastSyncAt).toBeNull();
    });

    it('reports an inspector with no connection as not connected', async () => {
        const m = (await membersById()).get(UNCONNECTED);
        expect(m?.calendarConnected).toBe(false);
        expect(m?.calendarLastSyncAt).toBeNull();
    });

    it('returns exactly one row per member', async () => {
        // Guards the sync lookup against multiplying the member list, which
        // would corrupt the callers that use it as an authorization roster.
        const { members } = await adminService.getMembers(TENANT);
        expect(members).toHaveLength(3);
        expect(new Set(members.map((m) => m.id)).size).toBe(3);
    });

    it('never reads another tenant connection for the same user id', async () => {
        await testDb.insert(schema.calendarConnections).values(
            connection('conn-3', OTHER_TENANT, UNCONNECTED, LAST_SYNC),
        );
        const m = (await membersById()).get(UNCONNECTED);
        expect(m?.calendarConnected).toBe(false);
        expect(m?.calendarLastSyncAt).toBeNull();
    });
});
