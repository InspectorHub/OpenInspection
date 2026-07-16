import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import calendarRoutes from '../../../server/api/calendar';
import type { HonoConfig } from '../../../server/types/hono';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { upsertCalendarConnection } from '../../../server/lib/calendar/connection';
import { MockKV } from '../mocks';

vi.mock('drizzle-orm/d1', () => ({
    drizzle: vi.fn(),
}));

import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-0000000000aa';
const USER = 'user-inspector-1';
const JWT_SECRET = 'calendar-api-test-secret-32chars!!';

function buildApp(testDb: BetterSQLite3Database<typeof schema>, kv: MockKV, opts?: { withSession?: boolean }) {
    const withSession = opts?.withSession !== false;
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        if (withSession) {
            c.set('user', { sub: USER, role: 'owner' } as HonoConfig['Variables']['user']);
            c.set('tenantId', TENANT);
        }
        await next();
    });
    app.route('/api/calendar', calendarRoutes);
    const env = {
        DB: {} as D1Database,
        JWT_SECRET,
        GOOGLE_CLIENT_ID: 'test-client-id',
        GOOGLE_CLIENT_SECRET: 'test-client-secret',
        TENANT_CACHE: kv as unknown as KVNamespace,
    };
    return { app, env };
}

function stubGoogleTokenExchange() {
    const fetchMock = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({
            access_token: 'access-tok',
            refresh_token: 'plain-refresh-should-not-persist',
            expires_in: 3600,
            scope: 'https://www.googleapis.com/auth/calendar.events',
        }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'primary' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

async function seedPendingOAuth(kv: MockKV, state: string, overrides?: Partial<{ userId: string; tenantId: string }>) {
    await kv.put(`cal-oauth:${state}`, JSON.stringify({
        userId: overrides?.userId ?? USER,
        tenantId: overrides?.tenantId ?? TENANT,
        verifier: 'pkce-verifier-12345678901234567890123456789012',
        capability: 'events_read_write',
        provider: 'google',
    }));
}

describe('calendar API — calendar_connections', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];
    let kv: MockKV;

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        sqlite = fixture.sqlite;
        kv = new MockKV();
        await setupSchema(sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);

        await testDb.insert(schema.tenants).values({
            id: TENANT,
            name: 'Acme',
            slug: 'acme',
            status: 'active',
            deploymentMode: 'shared',
            tier: 'free',
            createdAt: new Date(),
        });
        await testDb.insert(schema.users).values({
            id: USER,
            tenantId: TENANT,
            email: 'insp@acme.com',
            passwordHash: 'hash',
            role: 'inspector',
            createdAt: new Date(),
        });
    });

    afterEach(() => {
        sqlite.close();
        vi.clearAllMocks();
        vi.unstubAllGlobals();
    });

    it('push-events returns 403 for availability_read connection', async () => {
        await upsertCalendarConnection({
            db: {} as D1Database,
            tenantId: TENANT,
            userId: USER,
            provider: 'google',
            authType: 'oauth',
            capability: 'availability_read',
            calendarId: 'primary',
            credentials: { refreshToken: 'rt-avail', scopes: ['calendar.freebusy'] },
            jwtSecret: JWT_SECRET,
        });

        const { app, env } = buildApp(testDb, kv);
        const res = await app.request('/api/calendar/sync-events', { method: 'POST' }, env);
        expect(res.status).toBe(403);
        const body = await res.json() as { error: { message: string } };
        expect(body.error.message).toContain('write access');
    });

    it('callback persists encrypted credentials (not plaintext refresh token)', async () => {
        const state = 'oauth-state-token';
        await seedPendingOAuth(kv, state);
        stubGoogleTokenExchange();

        const { app, env } = buildApp(testDb, kv);
        const res = await app.request(`/api/calendar/callback?code=auth-code&state=${state}`, {}, env);
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain('oi:calendar-oauth:connected');
        expect(html).toContain('window.opener.postMessage');

        const rows = await testDb.select().from(schema.calendarConnections);
        expect(rows).toHaveLength(1);
        expect(rows[0].capabilities).toBe('events_read_write');
        expect(rows[0].credentialsEnc).not.toContain('plain-refresh-should-not-persist');
        expect(rows[0].credentialsEnc.startsWith('v2:')).toBe(true);
    });

    it('callback completes without session cookie (Google cross-site redirect)', async () => {
        const state = 'oauth-state-no-session';
        await seedPendingOAuth(kv, state);
        stubGoogleTokenExchange();

        const { app, env } = buildApp(testDb, kv, { withSession: false });
        const res = await app.request(`/api/calendar/callback?code=auth-code&state=${state}`, {}, env);
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain('oi:calendar-oauth:connected');

        const rows = await testDb.select().from(schema.calendarConnections);
        expect(rows).toHaveLength(1);
        expect(rows[0].userId).toBe(USER);
        expect(rows[0].tenantId).toBe(TENANT);
    });

    it('callback rejects when session cookie sub mismatches pending userId', async () => {
        const state = 'oauth-state-mismatch';
        await seedPendingOAuth(kv, state, { userId: USER });
        stubGoogleTokenExchange();

        const app = new OpenAPIHono<HonoConfig>();
        app.use('*', async (c, next) => {
            c.set('user', { sub: 'other-user-id', role: 'inspector' } as HonoConfig['Variables']['user']);
            c.set('tenantId', TENANT);
            await next();
        });
        app.route('/api/calendar', calendarRoutes);
        const env = {
            DB: {} as D1Database,
            JWT_SECRET,
            GOOGLE_CLIENT_ID: 'test-client-id',
            GOOGLE_CLIENT_SECRET: 'test-client-secret',
            TENANT_CACHE: kv as unknown as KVNamespace,
        };

        const res = await app.request(`/api/calendar/callback?code=auth-code&state=${state}`, {}, env);
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain('oi:calendar-oauth:error');
        expect(html).toContain('OAuth state mismatch');

        const rows = await testDb.select().from(schema.calendarConnections);
        expect(rows).toHaveLength(0);
    });

    it('disconnect removes the calendar_connections row', async () => {
        await upsertCalendarConnection({
            db: {} as D1Database,
            tenantId: TENANT,
            userId: USER,
            provider: 'google',
            authType: 'oauth',
            capability: 'events_read_write',
            calendarId: 'primary',
            credentials: { refreshToken: 'rt', scopes: ['calendar.events'] },
            jwtSecret: JWT_SECRET,
        });

        const { app, env } = buildApp(testDb, kv);
        const res = await app.request('/api/calendar/disconnect', { method: 'DELETE' }, env);
        expect(res.status).toBe(200);
        const rows = await testDb.select().from(schema.calendarConnections);
        expect(rows).toHaveLength(0);
    });

    it('status reports the current inspector calendar connection', async () => {
        await upsertCalendarConnection({
            db: {} as D1Database,
            tenantId: TENANT,
            userId: USER,
            provider: 'google',
            authType: 'oauth',
            capability: 'availability_read',
            calendarId: 'primary',
            credentials: { refreshToken: 'rt-status', scopes: ['calendar.freebusy'] },
            jwtSecret: JWT_SECRET,
        });

        const { app, env } = buildApp(testDb, kv);
        const res = await app.request('/api/calendar/status', {}, env);

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({
            success: true,
            data: {
                connected: true,
                capability: 'availability_read',
                provider: 'google',
                oauthConfigured: true,
            },
        });
    });
});
