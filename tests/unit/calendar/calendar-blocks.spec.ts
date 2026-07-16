import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import * as schema from '../../../server/lib/db/schema';
import calendarBlockRoutes from '../../../server/api/calendar-blocks';
import type { HonoConfig } from '../../../server/types/hono';
import { createTestDb, setupSchema } from '../db';

vi.mock('drizzle-orm/d1', () => ({
    drizzle: vi.fn(),
}));

const TENANT = '00000000-0000-0000-0000-0000000000aa';
const INSPECTOR = 'user-inspector-1';
const OTHER_INSPECTOR = 'user-inspector-2';
const MANAGER = 'user-manager-1';

type Role = 'owner' | 'manager' | 'inspector';

function buildApp(
    testDb: BetterSQLite3Database<typeof schema>,
    userId: string,
    role: Role,
) {
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('user', { sub: userId, role } as HonoConfig['Variables']['user']);
        c.set('userRole', role);
        c.set('tenantId', TENANT);
        await next();
    });
    app.route('/api/calendar', calendarBlockRoutes);
    return {
        app,
        env: { DB: {} as D1Database },
        testDb,
    };
}

function jsonRequest(method: 'POST' | 'PATCH' | 'DELETE', body?: unknown): RequestInit {
    return {
        method,
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
    };
}

describe('calendar blocks API', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        sqlite = fixture.sqlite;
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
        await testDb.insert(schema.users).values([
            {
                id: INSPECTOR,
                tenantId: TENANT,
                email: 'inspector-1@acme.com',
                passwordHash: 'hash',
                role: 'inspector',
                createdAt: new Date(),
            },
            {
                id: OTHER_INSPECTOR,
                tenantId: TENANT,
                email: 'inspector-2@acme.com',
                passwordHash: 'hash',
                role: 'inspector',
                createdAt: new Date(),
            },
            {
                id: MANAGER,
                tenantId: TENANT,
                email: 'manager@acme.com',
                passwordHash: 'hash',
                role: 'manager',
                createdAt: new Date(),
            },
        ]);
    });

    afterEach(() => {
        sqlite.close();
        vi.clearAllMocks();
    });

    it('allows an inspector to create an all-day block for self', async () => {
        const { app, env } = buildApp(testDb, INSPECTOR, 'inspector');
        const response = await app.request('/api/calendar/blocks', jsonRequest('POST', {
            title: 'Personal day',
            date: '2026-08-03',
            allDay: true,
            notes: 'Unavailable',
        }), env);

        expect(response.status).toBe(201);
        const body = await response.json() as { data: { block: { userId: string; allDay: boolean } } };
        expect(body.data.block).toMatchObject({ userId: INSPECTOR, allDay: true });
    });

    it('rejects an inspector creating a block for another user', async () => {
        const { app, env } = buildApp(testDb, INSPECTOR, 'inspector');
        const response = await app.request('/api/calendar/blocks', jsonRequest('POST', {
            userId: OTHER_INSPECTOR,
            title: 'Not mine',
            date: '2026-08-03',
            allDay: true,
        }), env);

        expect(response.status).toBe(403);
    });

    it('lists a user blocks within an inclusive civil-date range', async () => {
        const now = new Date();
        await testDb.insert(schema.calendarBlocks).values([
            {
                id: 'block-in-range-start',
                tenantId: TENANT,
                userId: INSPECTOR,
                title: 'Start boundary',
                date: '2026-08-01',
                allDay: true,
                createdAt: now,
                updatedAt: now,
            },
            {
                id: 'block-in-range-end',
                tenantId: TENANT,
                userId: INSPECTOR,
                title: 'End boundary',
                date: '2026-08-03',
                allDay: true,
                createdAt: now,
                updatedAt: now,
            },
            {
                id: 'block-out-of-range',
                tenantId: TENANT,
                userId: INSPECTOR,
                title: 'Outside',
                date: '2026-08-04',
                allDay: true,
                createdAt: now,
                updatedAt: now,
            },
        ]);

        const { app, env } = buildApp(testDb, INSPECTOR, 'inspector');
        const response = await app.request(
            '/api/calendar/blocks?start=2026-08-01&end=2026-08-03',
            {},
            env,
        );

        expect(response.status).toBe(200);
        const body = await response.json() as { data: { blocks: Array<{ id: string }> } };
        expect(body.data.blocks.map((block) => block.id)).toEqual([
            'block-in-range-start',
            'block-in-range-end',
        ]);
    });

    it('allows an admin to create a block for another inspector', async () => {
        const { app, env } = buildApp(testDb, MANAGER, 'manager');
        const response = await app.request('/api/calendar/blocks', jsonRequest('POST', {
            userId: OTHER_INSPECTOR,
            title: 'Training',
            date: '2026-08-05',
            startTime: '09:00',
            endTime: '12:00',
            allDay: false,
        }), env);

        expect(response.status).toBe(201);
        const body = await response.json() as { data: { block: { userId: string } } };
        expect(body.data.block.userId).toBe(OTHER_INSPECTOR);
    });

    it('allows an inspector to delete an own block', async () => {
        const now = new Date();
        await testDb.insert(schema.calendarBlocks).values({
            id: 'own-block',
            tenantId: TENANT,
            userId: INSPECTOR,
            title: 'Own block',
            date: '2026-08-06',
            allDay: true,
            createdAt: now,
            updatedAt: now,
        });
        const { app, env } = buildApp(testDb, INSPECTOR, 'inspector');

        const response = await app.request(
            '/api/calendar/blocks/own-block',
            jsonRequest('DELETE'),
            env,
        );

        expect(response.status).toBe(200);
        const rows = await testDb.select().from(schema.calendarBlocks);
        expect(rows).toHaveLength(0);
    });

    it('rejects an inspector deleting another user block', async () => {
        const now = new Date();
        await testDb.insert(schema.calendarBlocks).values({
            id: 'other-block',
            tenantId: TENANT,
            userId: OTHER_INSPECTOR,
            title: 'Other block',
            date: '2026-08-06',
            allDay: true,
            createdAt: now,
            updatedAt: now,
        });
        const { app, env } = buildApp(testDb, INSPECTOR, 'inspector');

        const response = await app.request(
            '/api/calendar/blocks/other-block',
            jsonRequest('DELETE'),
            env,
        );

        expect([403, 404]).toContain(response.status);
        const rows = await testDb.select().from(schema.calendarBlocks);
        expect(rows).toHaveLength(1);
    });
});
