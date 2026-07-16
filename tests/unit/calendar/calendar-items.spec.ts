import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import * as schema from '../../../server/lib/db/schema';
import calendarItemsRoutes from '../../../server/api/calendar-items';
import { listCalendarItems } from '../../../server/services/calendar-items.service';
import type { HonoConfig } from '../../../server/types/hono';
import { createTestDb, setupSchema } from '../db';

vi.mock('drizzle-orm/d1', () => ({
    drizzle: vi.fn(),
}));

const TENANT = '00000000-0000-0000-0000-0000000000aa';
const OTHER_TENANT = '00000000-0000-0000-0000-0000000000bb';
const INSPECTOR = 'user-inspector-1';
const OTHER_INSPECTOR = 'user-inspector-2';
const MANAGER = 'user-manager-1';

type Role = 'owner' | 'manager' | 'inspector';

function buildApp(userId: string, role: Role) {
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('user', { sub: userId, role } as HonoConfig['Variables']['user']);
        c.set('userRole', role);
        c.set('tenantId', TENANT);
        await next();
    });
    app.route('/api/calendar', calendarItemsRoutes);
    return {
        app,
        env: { DB: {} as D1Database },
    };
}

describe('calendar items feed', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        sqlite = fixture.sqlite;
        await setupSchema(sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);

        const now = new Date();
        await testDb.insert(schema.tenants).values([
            {
                id: TENANT,
                name: 'Acme',
                slug: 'acme',
                status: 'active',
                deploymentMode: 'shared',
                tier: 'free',
                createdAt: now,
            },
            {
                id: OTHER_TENANT,
                name: 'Other',
                slug: 'other',
                status: 'active',
                deploymentMode: 'shared',
                tier: 'free',
                createdAt: now,
            },
        ]);
        await testDb.insert(schema.users).values([
            {
                id: INSPECTOR,
                tenantId: TENANT,
                email: 'inspector-1@acme.com',
                passwordHash: 'hash',
                role: 'inspector',
                createdAt: now,
            },
            {
                id: OTHER_INSPECTOR,
                tenantId: TENANT,
                email: 'inspector-2@acme.com',
                passwordHash: 'hash',
                role: 'inspector',
                createdAt: now,
            },
            {
                id: MANAGER,
                tenantId: TENANT,
                email: 'manager@acme.com',
                passwordHash: 'hash',
                role: 'manager',
                createdAt: now,
            },
        ]);
    });

    afterEach(() => {
        sqlite.close();
        vi.clearAllMocks();
    });

    async function seedInspections() {
        const now = new Date();
        await testDb.insert(schema.inspections).values([
            {
                id: 'inspection-one',
                tenantId: TENANT,
                inspectorId: INSPECTOR,
                propertyAddress: '1 Main St',
                date: '2026-08-02',
                status: 'scheduled',
                paymentStatus: 'unpaid',
                price: 0,
                paymentRequired: false,
                agreementRequired: false,
                createdAt: now,
            },
            {
                id: 'inspection-two',
                tenantId: TENANT,
                inspectorId: OTHER_INSPECTOR,
                propertyAddress: '2 Main St',
                date: '2026-08-03',
                status: 'scheduled',
                paymentStatus: 'unpaid',
                price: 0,
                paymentRequired: false,
                agreementRequired: false,
                createdAt: now,
            },
            {
                id: 'inspection-outside',
                tenantId: TENANT,
                inspectorId: INSPECTOR,
                propertyAddress: '3 Main St',
                date: '2026-08-10',
                status: 'scheduled',
                paymentStatus: 'unpaid',
                price: 0,
                paymentRequired: false,
                agreementRequired: false,
                createdAt: now,
            },
            {
                id: 'inspection-other-tenant',
                tenantId: OTHER_TENANT,
                propertyAddress: '4 Main St',
                date: '2026-08-02',
                status: 'scheduled',
                paymentStatus: 'unpaid',
                price: 0,
                paymentRequired: false,
                agreementRequired: false,
                createdAt: now,
            },
        ]);
        await testDb.insert(schema.inspectionInspectors).values([
            {
                inspectionId: 'inspection-one',
                userId: INSPECTOR,
                tenantId: TENANT,
                role: 'lead',
                createdAt: now,
            },
            {
                inspectionId: 'inspection-two',
                userId: OTHER_INSPECTOR,
                tenantId: TENANT,
                role: 'lead',
                createdAt: now,
            },
        ]);
    }

    it('returns all tenant inspections for an unfiltered team query', async () => {
        await seedInspections();

        const items = await listCalendarItems({} as D1Database, TENANT, {
            start: '2026-08-01',
            end: '2026-08-05',
        });

        expect(items.filter((item) => item.kind === 'inspection')).toMatchObject([
            {
                id: 'inspection-one',
                title: '1 Main St',
                start: '2026-08-02',
                end: '2026-08-02',
                allDay: true,
                userId: INSPECTOR,
            },
            {
                id: 'inspection-two',
                title: '2 Main St',
                start: '2026-08-03',
                end: '2026-08-03',
                allDay: true,
                userId: OTHER_INSPECTOR,
            },
        ]);
    });

    it('filters inspections to selected assignees through the assignment table', async () => {
        await seedInspections();

        const items = await listCalendarItems({} as D1Database, TENANT, {
            start: '2026-08-01',
            end: '2026-08-05',
            userIds: [OTHER_INSPECTOR],
        });

        expect(items.filter((item) => item.kind === 'inspection').map((item) => item.id))
            .toEqual(['inspection-two']);
    });

    it('combines inspection events, calendar blocks, and blocking overrides', async () => {
        await seedInspections();
        const now = new Date();
        await testDb.insert(schema.eventTypes).values({
            id: 'event-type-radon',
            tenantId: TENANT,
            name: 'Radon pickup',
            slug: 'radon-pickup',
            defaultDurationMin: 30,
            defaultPriceCents: 0,
            color: '#6366f1',
            sortOrder: 0,
            active: true,
            createdAt: now,
        });
        await testDb.insert(schema.inspectionEvents).values({
            id: 'inspection-event-one',
            tenantId: TENANT,
            inspectionId: 'inspection-one',
            eventTypeId: 'event-type-radon',
            inspectorId: INSPECTOR,
            scheduledAt: new Date('2026-08-02T15:00:00.000Z'),
            durationMin: 30,
            priceCents: 0,
            status: 'scheduled',
            createdAt: now,
        });
        await testDb.insert(schema.calendarBlocks).values({
            id: 'calendar-block-one',
            tenantId: TENANT,
            userId: INSPECTOR,
            title: 'Training',
            date: '2026-08-03',
            startTime: '09:00',
            endTime: '10:30',
            allDay: false,
            createdAt: now,
            updatedAt: now,
        });
        await testDb.insert(schema.availabilityOverrides).values([
            {
                id: 'busy-one',
                tenantId: TENANT,
                inspectorId: INSPECTOR,
                date: '2026-08-04',
                isAvailable: false,
                createdAt: now,
            },
            {
                id: 'available-one',
                tenantId: TENANT,
                inspectorId: INSPECTOR,
                date: '2026-08-05',
                isAvailable: true,
                startTime: '09:00',
                endTime: '12:00',
                createdAt: now,
            },
        ]);

        const items = await listCalendarItems({} as D1Database, TENANT, {
            start: '2026-08-01',
            end: '2026-08-05',
            userIds: [INSPECTOR],
        });

        expect(items.map((item) => item.kind)).toEqual([
            'inspection',
            'inspection_event',
            'calendar_block',
            'external_busy',
        ]);
        expect(items.find((item) => item.kind === 'inspection_event')).toMatchObject({
            id: 'inspection-event-one',
            title: 'Radon pickup',
            start: '2026-08-02T15:00:00.000Z',
            end: '2026-08-02T15:30:00.000Z',
            allDay: false,
            inspectionId: 'inspection-one',
            userId: INSPECTOR,
        });
        expect(items.find((item) => item.kind === 'calendar_block')).toMatchObject({
            start: '2026-08-03T09:00:00.000Z',
            end: '2026-08-03T10:30:00.000Z',
        });
    });

    it('forbids inspectors from selecting another user', async () => {
        const { app, env } = buildApp(INSPECTOR, 'inspector');
        const response = await app.request(
            `/api/calendar/items?start=2026-08-01&end=2026-08-05&userId=${OTHER_INSPECTOR}`,
            {},
            env,
        );

        expect(response.status).toBe(403);
    });

    it('allows managers to select multiple users', async () => {
        await seedInspections();
        const { app, env } = buildApp(MANAGER, 'manager');
        const response = await app.request(
            `/api/calendar/items?start=2026-08-01&end=2026-08-05&userIds=${INSPECTOR},${OTHER_INSPECTOR}`,
            {},
            env,
        );

        expect(response.status).toBe(200);
        const body = await response.json() as { data: { items: Array<{ id: string }> } };
        expect(body.data.items.map((item) => item.id)).toEqual([
            'inspection-one',
            'inspection-two',
        ]);
    });

    it('rejects conflicting userId and userIds parameters', async () => {
        const { app, env } = buildApp(MANAGER, 'manager');
        const response = await app.request(
            `/api/calendar/items?start=2026-08-01&end=2026-08-05&userId=${INSPECTOR}&userIds=${OTHER_INSPECTOR}`,
            {},
            env,
        );

        expect(response.status).toBe(400);
    });
});
