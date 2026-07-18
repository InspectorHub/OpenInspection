import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { HonoConfig } from '../../../server/types/hono';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { upsertCalendarConnection } from '../../../server/lib/calendar/connection';
import { MockKV } from '../mocks';

vi.mock('drizzle-orm/d1', () => ({
    drizzle: vi.fn(),
}));

const listBusy = vi.fn();
vi.mock('../../../server/lib/calendar/registry', () => ({
    getCalendarProvider: () => ({
        id: 'google',
        listBusy,
    }),
}));

import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import calendarRoutes from '../../../server/api/calendar';

const TENANT = '00000000-0000-0000-0000-0000000000aa';
const USER = 'user-inspector-1';
const JWT_SECRET = 'calendar-api-test-secret-32chars!!';

function buildApp(kv: MockKV) {
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('user', { sub: USER, role: 'owner' } as HonoConfig['Variables']['user']);
        c.set('tenantId', TENANT);
        await next();
    });
    app.route('/api/calendar', calendarRoutes);
    return {
        app,
        env: {
            DB: {} as D1Database,
            JWT_SECRET,
            GOOGLE_CLIENT_ID: 'test-client-id',
            GOOGLE_CLIENT_SECRET: 'test-client-secret',
            TENANT_CACHE: kv as unknown as KVNamespace,
        },
    };
}

async function readConnection(testDb: BetterSQLite3Database<typeof schema>) {
    return testDb.select().from(schema.calendarConnections)
        .where(eq(schema.calendarConnections.userId, USER)).get();
}

describe('calendar sync freshness', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];
    let kv: MockKV;

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        sqlite = fixture.sqlite;
        kv = new MockKV();
        await setupSchema(sqlite);
        (mockDrizzle as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        listBusy.mockReset();

        await testDb.insert(schema.tenants).values({
            id: TENANT, name: 'Acme', slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await testDb.insert(schema.users).values({
            id: USER, tenantId: TENANT, email: 'insp@acme.com',
            passwordHash: 'hash', role: 'inspector', createdAt: new Date(),
        });
        await upsertCalendarConnection({
            db: {} as D1Database,
            tenantId: TENANT,
            userId: USER,
            provider: 'google',
            authType: 'oauth',
            capability: 'availability_read',
            calendarId: 'primary',
            credentials: { refreshToken: 'refresh-tok', scopes: ['calendar.freebusy'] },
            jwtSecret: JWT_SECRET,
        });
    });

    afterEach(() => {
        sqlite.close();
        vi.clearAllMocks();
    });

    it('leaves lastSyncAt null until a sync succeeds', async () => {
        expect((await readConnection(testDb))?.lastSyncAt ?? null).toBeNull();
    });

    it('stamps lastSyncAt after a successful busy pull', async () => {
        listBusy.mockResolvedValue([]);
        const { app, env } = buildApp(kv);
        const before = Date.now();

        const res = await app.request('/api/calendar/sync', { method: 'POST' }, env);

        expect(res.status).toBe(200);
        const stamped = (await readConnection(testDb))?.lastSyncAt;
        expect(stamped).toBeInstanceOf(Date);
        expect(stamped!.getTime()).toBeGreaterThanOrEqual(before);
    });

    it('leaves lastSyncAt untouched when the provider pull fails', async () => {
        // A failed pull means the calendar is NOT fresh; stamping it would make
        // the badge vouch for data we never fetched.
        listBusy.mockRejectedValue(new Error('google is down'));
        const { app, env } = buildApp(kv);

        const res = await app.request('/api/calendar/sync', { method: 'POST' }, env);

        expect(res.status).toBe(500);
        expect((await readConnection(testDb))?.lastSyncAt ?? null).toBeNull();
    });
});
