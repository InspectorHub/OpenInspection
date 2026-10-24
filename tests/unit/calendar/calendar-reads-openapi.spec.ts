/**
 * GET /api/calendar/status, GET /api/calendar/read-set and GET /api/calendar/ics-links are OpenAPI routes. They
 * answer what the plain handlers did: the same bodies, the same 401 when the request carries no session. These run
 * against the real router; only the Google calendar list call and the drizzle driver are stood in.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import calendarRoutes from '../../../server/api/calendar';
import type { HonoConfig } from '../../../server/types/hono';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { upsertCalendarConnection } from '../../../server/lib/calendar/connection';
import { buildOpenApiDocument } from '../../../server/lib/openapi/build-document';
import { MockKV } from '../mocks';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
vi.mock('../../../server/lib/google-calendar', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../server/lib/google-calendar')>();
    return { ...actual, refreshAccessToken: vi.fn().mockResolvedValue('access-token') };
});

import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-0000000000bb';
const USER = 'user-inspector-2';
const JWT_SECRET = 'calendar-reads-test-secret-32chars!';

function buildApp(
    testDb: BetterSQLite3Database<typeof schema>,
    opts: { withSession?: boolean; role?: string; secret?: string | undefined } = {},
) {
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        if (opts.withSession !== false) {
            c.set('user', { sub: USER, role: opts.role ?? 'inspector' } as HonoConfig['Variables']['user']);
            c.set('tenantId', TENANT);
            c.set('userRole', (opts.role ?? 'inspector') as HonoConfig['Variables']['userRole']);
        }
        await next();
    });
    app.route('/api/calendar', calendarRoutes);
    const env = {
        DB: {} as D1Database,
        JWT_SECRET: 'secret' in opts ? opts.secret : JWT_SECRET,
        GOOGLE_CLIENT_ID: 'test-client-id',
        GOOGLE_CLIENT_SECRET: 'test-client-secret',
        TENANT_CACHE: new MockKV() as unknown as KVNamespace,
    };
    return { app, env };
}

describe('calendar reads served through OpenAPI routes', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        sqlite = fixture.sqlite;
        await setupSchema(sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        await testDb.insert(schema.tenants).values({
            id: TENANT, slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await testDb.insert(schema.users).values({
            id: USER, tenantId: TENANT, email: 'insp2@acme.com', passwordHash: 'hash', role: 'inspector', slug: 'jo', createdAt: new Date(),
        });
    });

    afterEach(() => {
        sqlite.close();
        vi.clearAllMocks();
        vi.unstubAllGlobals();
    });

    const connect = () => upsertCalendarConnection({
        db: {} as D1Database, tenantId: TENANT, userId: USER, provider: 'google', authType: 'oauth',
        capability: 'events_read_write', calendarId: 'primary',
        credentials: { refreshToken: 'rt-reads', scopes: ['calendar.events'] }, jwtSecret: JWT_SECRET,
    });

    describe('GET /status', () => {
        it('answers the not-connected shape with 200', async () => {
            const { app, env } = buildApp(testDb);
            const res = await app.request('/api/calendar/status', {}, env);
            expect(res.status).toBe(200);
            expect(await res.json()).toEqual({
                success: true,
                data: { connected: false, capability: null, provider: null, oauthConfigured: true, lastSyncAt: null, lastSyncError: null },
            });
        });

        it('refuses a request with no session with the plain 401 body', async () => {
            const { app, env } = buildApp(testDb, { withSession: false });
            const res = await app.request('/api/calendar/status', {}, env);
            expect(res.status).toBe(401);
            expect(await res.json()).toEqual({ success: false, error: { message: 'Not authenticated' } });
        });

        it('takes no input, so a stray query string changes nothing', async () => {
            const { app, env } = buildApp(testDb);
            const res = await app.request('/api/calendar/status?connected=yes', {}, env);
            expect(res.status).toBe(200);
        });
    });

    describe('GET /read-set', () => {
        it('answers { connected: false } when nothing is connected', async () => {
            const { app, env } = buildApp(testDb);
            const res = await app.request('/api/calendar/read-set', {}, env);
            expect(res.status).toBe(200);
            expect(await res.json()).toEqual({ success: true, data: { connected: false } });
        });

        it('refuses a request with no session with the plain 401 body', async () => {
            const { app, env } = buildApp(testDb, { withSession: false });
            const res = await app.request('/api/calendar/read-set', {}, env);
            expect(res.status).toBe(401);
            expect(await res.json()).toEqual({ success: false, error: { message: 'Not authenticated' } });
        });

        it('lists the provider calendars, the read set and the write target for a connection', async () => {
            await connect();
            vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
                items: [
                    { id: 'primary', summary: 'Me', accessRole: 'owner', primary: true },
                    { id: 'work@grp', summary: 'Work', accessRole: 'writer' },
                ],
            }), { status: 200 })));
            const { app, env } = buildApp(testDb);
            const res = await app.request('/api/calendar/read-set', {}, env);
            expect(res.status).toBe(200);
            const body = await res.json() as { data: Record<string, unknown> };
            expect(body.data).toMatchObject({
                connected: true,
                writeCalendarId: 'primary',
                readCalendarIds: ['primary'],
                calendars: [
                    { id: 'primary', summary: 'Me', accessRole: 'owner', primary: true },
                    { id: 'work@grp', summary: 'Work', accessRole: 'writer', primary: false },
                ],
            });
            expect(typeof body.data.connectionId).toBe('string');
        });

        it('still answers 200 with an empty calendar list when the provider cannot be reached', async () => {
            await connect();
            vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 500 })));
            const { app, env } = buildApp(testDb);
            const res = await app.request('/api/calendar/read-set', {}, env);
            expect(res.status).toBe(200);
            const body = await res.json() as { data: { connected: boolean; calendars: unknown[] } };
            expect(body.data.connected).toBe(true);
            expect(body.data.calendars).toEqual([]);
        });
    });

    describe('GET /ics-links', () => {
        it('gives an inspector the busy and schedule paths and no company path', async () => {
            const { app, env } = buildApp(testDb);
            const res = await app.request('/api/calendar/ics-links', {}, env);
            expect(res.status).toBe(200);
            const body = await res.json() as { success: boolean; data: { busyPath: string; schedulePath: string; companyPath: string | null } };
            expect(body.success).toBe(true);
            expect(body.data.busyPath).toBe('/inspector/acme/jo/calendar.ics');
            expect(body.data.schedulePath).toMatch(/^\/api\/ics\/inspector\/.+/);
            expect(body.data.companyPath).toBeNull();
        });

        it('gives an owner the company feed once the tenant has a feed token', async () => {
            await testDb.insert(schema.tenantConfigs).values({ tenantId: TENANT, icsToken: 'feedtoken123', updatedAt: new Date() } as never);
            const { app, env } = buildApp(testDb, { role: 'owner' });
            const res = await app.request('/api/calendar/ics-links', {}, env);
            const body = await res.json() as { data: { companyPath: string | null } };
            expect(body.data.companyPath).toBe('/api/ics/feedtoken123');
        });

        it('leaves the schedule path null when the deployment has no signing secret', async () => {
            const { app, env } = buildApp(testDb, { secret: undefined });
            const res = await app.request('/api/calendar/ics-links', {}, env);
            const body = await res.json() as { data: { schedulePath: string | null } };
            expect(body.data.schedulePath).toBeNull();
        });

        it('refuses a request with no session with the plain 401 body', async () => {
            const { app, env } = buildApp(testDb, { withSession: false });
            const res = await app.request('/api/calendar/ics-links', {}, env);
            expect(res.status).toBe(401);
            expect(await res.json()).toEqual({ success: false, error: { message: 'Not authenticated' } });
        });
    });

    it('lists the reads in the OpenAPI document: status and read-set as extended-tier reads, the feed links as excluded', () => {
        const { app } = buildApp(testDb);
        const doc = buildOpenApiDocument(app, { openapi: '3.0.0', info: { version: 'test', title: 't' } });
        const ops = {
            status: doc.paths?.['/api/calendar/status']?.get as Record<string, unknown> | undefined,
            readSet: doc.paths?.['/api/calendar/read-set']?.get as Record<string, unknown> | undefined,
            ics: doc.paths?.['/api/calendar/ics-links']?.get as Record<string, unknown> | undefined,
        };
        expect(ops.status?.operationId).toBe('getGoogleCalendarStatus');
        expect(ops.readSet?.operationId).toBe('getCalendarReadSet');
        expect(ops.ics?.operationId).toBe('getCalendarIcsLinks');
        for (const op of [ops.status, ops.readSet]) {
            expect(op?.['x-scopes']).toEqual(['read']);
            expect(op?.['x-tier']).toBe('extended');
        }
        // The feed links are long-lived bearer-style URLs (a sealed schedule token, the company feed token for
        // owners and managers). An MCP tool holding only a read scope must not be able to mint or read them.
        expect(ops.ics?.['x-scopes']).toEqual([]);
        expect(ops.ics?.['x-tier']).toBe('excluded');
    });
});
