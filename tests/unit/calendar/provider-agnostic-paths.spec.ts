/**
 * The interface is multi-provider; these are the paths that still named Google
 * as a literal. A connection row is the authority on its own provider, and each
 * of these reads it from the row rather than assuming.
 *
 * The `calendar_connections` columns already admit `apple` / `caldav`, so this
 * needs no schema change — which is the point: the enums were honest and the
 * code was not.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb, setupSchema, toRawD1 } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', async (orig) => ({
    ...(await orig<Record<string, unknown>>()),
    drizzle: vi.fn(),
}));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const listBusy = vi.fn();
const askedFor: (string | undefined)[] = [];
vi.mock('../../../server/lib/calendar/registry', () => ({
    getCalendarProvider: (id?: string) => {
        askedFor.push(id);
        return { id, listBusy };
    },
}));

import { sealCredentials } from '../../../server/lib/calendar/credentials';
import { loadOpenCalendarConnection } from '../../../server/lib/calendar/connection';
import { getGoogleCalendarStatus } from '../../../server/lib/calendar/status';
import { importBusyForConnection } from '../../../server/lib/calendar/sync-engine';
import { AdminService } from '../../../server/services/admin.service';
import type { CalendarConnectionRow } from '../../../server/lib/calendar/connection';
import type { CalendarAuth } from '../../../server/lib/calendar/provider';
import type { HonoConfig } from '../../../server/types/hono';

const TENANT = '00000000-0000-0000-0000-000000000001';
const USER = '00000000-0000-0000-0000-000000000010';
const SECRET = 'calendar-provider-agnostic-secret!';
const NOW = Date.UTC(2026, 5, 1, 12, 0);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

const auth = { provider: 'apple', material: {} } as CalendarAuth;

describe('provider-agnostic calendar paths', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];
    let rawDb: D1Database;

    async function seedAppleConnection() {
        const sealed = await sealCredentials(
            { username: 'inspector@icloud.com', appPassword: 'pw', url: 'https://p42-caldav.icloud.com/1/calendars/' },
            TENANT,
            SECRET,
        );
        await db.insert(schema.calendarConnections).values({
            id: 'conn-apple', tenantId: TENANT, userId: USER,
            provider: 'apple', authType: 'caldav',
            credentialsEnc: sealed.credentialsEnc,
            credentialsDekEnc: sealed.credentialsDekEnc,
            capabilities: 'events_read_write',
            calendarId: 'https://p42-caldav.icloud.com/1/calendars/home/',
            connectedAt: new Date(NOW - 60 * 60 * 1000),
            updatedAt: new Date(NOW - 60 * 60 * 1000),
            lastSyncAt: null,
        });
    }

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        sqlite = fixture.sqlite;
        await setupSchema(sqlite);
        rawDb = toRawD1(sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(db);
        await db.insert(schema.tenants).values({
            id: TENANT, name: 'A', slug: 'a', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await db.insert(schema.tenantConfigs).values({
            tenantId: TENANT, defaultTimezone: 'America/New_York', updatedAt: new Date(),
        });
        await db.insert(schema.users).values({
            id: USER, tenantId: TENANT, email: 'i@t.com', role: 'inspector',
            passwordHash: 'x', createdAt: new Date(),
        });
        listBusy.mockReset().mockResolvedValue([]);
        askedFor.length = 0;
    });

    afterEach(() => { sqlite.close(); vi.clearAllMocks(); });

    it('loads a non-Google connection when no provider is named', async () => {
        await seedAppleConnection();
        const open = await loadOpenCalendarConnection(rawDb, TENANT, USER, SECRET);
        expect(open).not.toBeNull();
        expect(open!.connection.provider).toBe('apple');
        expect(open!.credentials).toEqual({
            username: 'inspector@icloud.com',
            appPassword: 'pw',
            url: 'https://p42-caldav.icloud.com/1/calendars/',
        });
    });

    it('reports the connection\'s real provider in status', async () => {
        await seedAppleConnection();
        const status = await getGoogleCalendarStatus(
            { DB: rawDb, JWT_SECRET: SECRET } as unknown as HonoConfig['Bindings'],
            TENANT,
            USER,
        );
        expect(status.connected).toBe(true);
        expect(status.provider).toBe('apple');
    });

    it('counts a non-Google connection as a connected team member', async () => {
        await seedAppleConnection();
        const members = await new AdminService(rawDb).getMembers(TENANT);
        expect(members.members.find((m) => m.id === USER)?.calendarConnected).toBe(true);
    });

    it('asks the registry for the connection\'s own provider, not google', async () => {
        await seedAppleConnection();
        const connection = (await db.select().from(schema.calendarConnections).all())[0] as CalendarConnectionRow;
        await importBusyForConnection(db as AnyDb, connection, auth, NOW);
        expect(askedFor).toContain('apple');
        expect(askedFor).not.toContain('google');
    });
});
