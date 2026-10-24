/**
 * PUT /api/calendar/connections/{id}/calendars is an OpenAPI route. It answers what the plain handler did: the same
 * bodies and statuses, and the same ORDER of checks (session, then the caller's own connection, then the body, then the
 * provider). These run against the real router; only the Google calendar list call and the drizzle driver are stood in.
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

const TENANT = '00000000-0000-0000-0000-0000000000cc';
const USER = 'user-inspector-save';
const JWT_SECRET = 'calendar-save-test-secret-32chars!!';

function buildApp(testDb: BetterSQLite3Database<typeof schema>, opts: { withSession?: boolean } = {}) {
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        if (opts.withSession !== false) {
            c.set('user', { sub: USER, role: 'inspector' } as HonoConfig['Variables']['user']);
            c.set('tenantId', TENANT);
            c.set('userRole', 'inspector');
        }
        await next();
    });
    app.route('/api/calendar', calendarRoutes);
    const env = {
        DB: {} as D1Database, JWT_SECRET, GOOGLE_CLIENT_ID: 'test-client-id', GOOGLE_CLIENT_SECRET: 'test-client-secret',
        TENANT_CACHE: new MockKV() as unknown as KVNamespace,
    };
    return { app, env };
}

const put = (body: unknown, raw = false) => ({
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: raw ? String(body) : JSON.stringify(body),
});

describe('PUT /api/calendar/connections/{id}/calendars', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];
    let connectionId: string;

    const listing = (items: unknown[]) => vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify({ items }), { status: 200 })));
    const CALENDARS = [
        { id: 'primary', summary: 'Me', accessRole: 'owner', primary: true },
        { id: 'work@grp', summary: 'Work', accessRole: 'writer' },
        { id: 'ro@grp', summary: 'Read only', accessRole: 'reader' },
    ];

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
            id: USER, tenantId: TENANT, email: 'save@acme.com', passwordHash: 'hash', role: 'inspector', slug: 'sv', createdAt: new Date(),
        });
    });

    afterEach(() => {
        sqlite.close();
        vi.clearAllMocks();
        vi.unstubAllGlobals();
    });

    const connect = async () => {
        await upsertCalendarConnection({
            db: {} as D1Database, tenantId: TENANT, userId: USER, provider: 'google', authType: 'oauth',
            capability: 'events_read_write', calendarId: 'primary',
            credentials: { refreshToken: 'rt-save', scopes: ['calendar.events'] }, jwtSecret: JWT_SECRET,
        });
        const row = await testDb.select().from(schema.calendarConnections).get();
        connectionId = row!.id;
    };

    it('refuses a request with no session with the plain 401 body, before looking at the id or the body', async () => {
        const { app, env } = buildApp(testDb, { withSession: false });
        const res = await app.request('/api/calendar/connections/any/calendars', put('not json', true), env);
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ success: false, error: { message: 'Not authenticated' } });
    });

    it('answers 404 when the caller has no connection, even for a body that is not a read set (the connection check comes first)', async () => {
        const { app, env } = buildApp(testDb);
        const res = await app.request('/api/calendar/connections/c1/calendars', put({ nonsense: true }), env);
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ success: false, error: { message: 'Google Calendar not connected' } });
    });

    it('answers 404 for a connection id that is not the caller own, and 200 for the own one with the same body', async () => {
        await connect();
        listing(CALENDARS);
        const { app, env } = buildApp(testDb);
        const body = { readCalendarIds: ['primary'], writeCalendarId: 'primary' };
        const other = await app.request('/api/calendar/connections/someone-else/calendars', put(body), env);
        expect(other.status).toBe(404);
        expect(await other.json()).toEqual({ success: false, error: { message: 'Google Calendar not connected' } });
        const own = await app.request(`/api/calendar/connections/${connectionId}/calendars`, put(body), env);
        expect(own.status).toBe(200);
    });

    it('answers its own 400 for a body that is not a read set, with the flattened details and not the validation envelope', async () => {
        await connect();
        const { app, env } = buildApp(testDb);
        const bad = await app.request(`/api/calendar/connections/${connectionId}/calendars`, put({ readCalendarIds: [] }), env);
        expect(bad.status).toBe(400);
        const body = await bad.json() as { success: boolean; error: { message: string; code?: string; details: { fieldErrors: Record<string, unknown> } } };
        expect(body.success).toBe(false);
        expect(body.error.message).toBe('Invalid read set');
        expect(body.error.code).toBeUndefined();
        expect(Object.keys(body.error.details.fieldErrors).sort()).toEqual(['readCalendarIds', 'writeCalendarId']);
        // A body that is not JSON takes the same answer.
        const garbled = await app.request(`/api/calendar/connections/${connectionId}/calendars`, put('{nope', true), env);
        expect(garbled.status).toBe(400);
        expect(((await garbled.json()) as { error: { message: string } }).error.message).toBe('Invalid read set');
    });

    it('saves the read set and the write target, which the read-set read then returns', async () => {
        await connect();
        listing(CALENDARS);
        const { app, env } = buildApp(testDb);
        const res = await app.request(`/api/calendar/connections/${connectionId}/calendars`,
            put({ readCalendarIds: ['primary', 'work@grp'], writeCalendarId: 'work@grp' }), env);
        expect(res.status).toBe(200);
        const saved = await res.json() as { success: boolean; data: { readCalendarIds: string[]; writeCalendarId: string } };
        expect(saved.success).toBe(true);
        expect(saved.data.writeCalendarId).toBe('work@grp');
        expect([...saved.data.readCalendarIds].sort()).toEqual(['primary', 'work@grp']);
        const read = await app.request('/api/calendar/read-set', {}, env);
        const after = await read.json() as { data: { readCalendarIds: string[]; writeCalendarId: string } };
        expect(after.data.writeCalendarId).toBe('work@grp');
        expect([...after.data.readCalendarIds].sort()).toEqual(['primary', 'work@grp']);
    });

    it('refuses a write target the user cannot edit (409) or the provider does not list (400), with the rule message and code', async () => {
        await connect();
        listing(CALENDARS);
        const { app, env } = buildApp(testDb);
        const res = await app.request(`/api/calendar/connections/${connectionId}/calendars`,
            put({ readCalendarIds: ['primary', 'ro@grp'], writeCalendarId: 'ro@grp' }), env);
        expect(res.status).toBe(409);
        const body = await res.json() as { success: boolean; error: { code: string; message: string } };
        expect(body.success).toBe(false);
        expect(typeof body.error.code).toBe('string');
        expect(body.error.message).toBe('The write calendar must be one you can edit (owner or writer access).');
        // A write calendar the provider does not list takes the 400 of the same rule set.
        const missing = await app.request(`/api/calendar/connections/${connectionId}/calendars`,
            put({ readCalendarIds: ['primary'], writeCalendarId: 'nowhere@grp' }), env);
        expect(missing.status).toBe(400);
        expect(((await missing.json()) as { error: { message: string } }).error.message).toBe('The selected write calendar was not found.');
    });

    it('answers 500 when the provider calendar list cannot be fetched', async () => {
        await connect();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 500 })));
        const { app, env } = buildApp(testDb);
        const res = await app.request(`/api/calendar/connections/${connectionId}/calendars`,
            put({ readCalendarIds: ['primary'], writeCalendarId: 'primary' }), env);
        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({ success: false, error: { message: 'Failed to fetch Google calendars' } });
    });

    it('is listed in the OpenAPI document as an excluded operation with no request body (the handler reads its own)', () => {
        const { app } = buildApp(testDb);
        const doc = buildOpenApiDocument(app, { openapi: '3.0.0', info: { version: 'test', title: 't' } });
        const op = doc.paths?.['/api/calendar/connections/{id}/calendars']?.put as Record<string, unknown> | undefined;
        expect(op?.operationId).toBe('saveCalendarReadSet');
        expect(op?.['x-tier']).toBe('excluded');
        expect(op?.['x-scopes']).toEqual([]);
        expect(op?.requestBody).toBeUndefined();
    });
});
