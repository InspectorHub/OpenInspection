import { beforeEach, describe, expect, it, vi } from 'vitest';
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
const INSPECTOR = 'user-inspector-1';
const MANAGER = 'user-manager-1';

function buildApp(userId: string, role: 'owner' | 'manager' | 'inspector') {
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('user', { sub: userId, role } as HonoConfig['Variables']['user']);
        c.set('userRole', role);
        c.set('tenantId', TENANT);
        await next();
    });
    app.route('/api/calendar', calendarItemsRoutes);
    return { app, env: { DB: {} as D1Database } };
}

describe('calendar items — timezone-correct civil date bucketing', () => {
    let testDb: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        await setupSchema(fixture.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);

        const now = new Date();
        await testDb.insert(schema.tenants).values({
            id: TENANT,
            name: 'Acme',
            slug: 'acme',
            status: 'active',
            deploymentMode: 'shared',
            tier: 'free',
            createdAt: now,
        });
        await testDb.insert(schema.users).values({
            id: INSPECTOR,
            tenantId: TENANT,
            email: 'inspector-1@acme.com',
            passwordHash: 'hash',
            role: 'inspector',
            createdAt: now,
        });
    });

    it('passes a timed block through as its stored civil date and wall-clock time, regardless of tz', async () => {
        const now = new Date();
        await testDb.insert(schema.calendarBlocks).values({
            id: 'block-1',
            tenantId: TENANT,
            userId: INSPECTOR,
            title: 'Dentist',
            date: '2026-07-17',
            startTime: '09:00',
            endTime: '10:00',
            allDay: false,
            createdAt: now,
            updatedAt: now,
        });

        const items = await listCalendarItems({} as D1Database, TENANT, {
            start: '2026-07-13',
            end: '2026-07-19',
            userIds: [INSPECTOR],
            effectiveTz: 'Asia/Shanghai',
        });

        const block = items.find((item) => item.kind === 'calendar_block');
        // The block was authored as 09:00 on 2026-07-17 in the inspector's own
        // (tenant) timezone; it must render on that exact civil day and time in
        // any viewer timezone — never shifted to 07-18 the way UTC bucketing did.
        expect(block).toMatchObject({
            civilDate: '2026-07-17',
            startTime: '09:00',
            endTime: '10:00',
            // The instant is 09:00 Shanghai (UTC+8) = 01:00Z — NOT the old
            // hardcoded 09:00Z, so the detail modal formats back to 09:00.
            start: '2026-07-17T01:00:00.000Z',
            end: '2026-07-17T02:00:00.000Z',
        });
    });

    it('converts an instant-based inspection event into the effective timezone', async () => {
        const now = new Date();
        await testDb.insert(schema.inspections).values({
            id: 'inspection-1',
            tenantId: TENANT,
            inspectorId: INSPECTOR,
            propertyAddress: '1 Main St',
            date: '2026-07-01', // outside the query window; present only for the event FK
            status: 'scheduled',
            paymentStatus: 'unpaid',
            price: 0,
            paymentRequired: false,
            agreementRequired: false,
            createdAt: now,
        });
        await testDb.insert(schema.eventTypes).values({
            id: 'event-type-1',
            tenantId: TENANT,
            name: 'Radon pickup',
            slug: 'radon-pickup',
            defaultDurationMin: 60,
            defaultPriceCents: 0,
            color: '#6366f1',
            sortOrder: 0,
            active: true,
            createdAt: now,
        });
        await testDb.insert(schema.inspectionEvents).values({
            id: 'event-1',
            tenantId: TENANT,
            inspectionId: 'inspection-1',
            eventTypeId: 'event-type-1',
            inspectorId: INSPECTOR,
            scheduledAt: new Date('2026-07-17T20:00:00.000Z'),
            durationMin: 60,
            priceCents: 0,
            status: 'scheduled',
            createdAt: now,
        });

        const items = await listCalendarItems({} as D1Database, TENANT, {
            start: '2026-07-13',
            end: '2026-07-20',
            userIds: [INSPECTOR],
            effectiveTz: 'Asia/Shanghai',
        });

        const event = items.find((item) => item.kind === 'inspection_event');
        // 2026-07-17T20:00Z is 2026-07-18 04:00 in Asia/Shanghai (UTC+8), so the
        // event belongs to the 07-18 cell at 04:00 for a viewer in that zone.
        expect(event).toMatchObject({
            civilDate: '2026-07-18',
            startTime: '04:00',
            endTime: '05:00',
        });
    });

    it('emits civilDate for all-day inspections and external busy overrides', async () => {
        const now = new Date();
        await testDb.insert(schema.inspections).values({
            id: 'inspection-allday',
            tenantId: TENANT,
            inspectorId: INSPECTOR,
            propertyAddress: '5 Oak St',
            date: '2026-07-15',
            status: 'scheduled',
            paymentStatus: 'unpaid',
            price: 0,
            paymentRequired: false,
            agreementRequired: false,
            createdAt: now,
        });
        await testDb.insert(schema.availabilityOverrides).values({
            id: 'busy-1',
            tenantId: TENANT,
            inspectorId: INSPECTOR,
            date: '2026-07-16',
            isAvailable: false,
            createdAt: now,
        });

        const items = await listCalendarItems({} as D1Database, TENANT, {
            start: '2026-07-13',
            end: '2026-07-19',
            userIds: [INSPECTOR],
            effectiveTz: 'Asia/Shanghai',
        });

        expect(items.find((item) => item.kind === 'inspection')).toMatchObject({
            civilDate: '2026-07-15',
            allDay: true,
        });
        expect(items.find((item) => item.kind === 'external_busy')).toMatchObject({
            civilDate: '2026-07-16',
        });
    });

    it('resolves the viewer effective tz (user override beats tenant default) through the route', async () => {
        const now = new Date();
        // Tenant default is New York; the viewing user overrides to Shanghai.
        await testDb.insert(schema.tenantConfigs).values({
            tenantId: TENANT,
            defaultTimezone: 'America/New_York',
            updatedAt: now,
        });
        await testDb.insert(schema.users).values({
            id: MANAGER,
            tenantId: TENANT,
            email: 'manager@acme.com',
            passwordHash: 'hash',
            role: 'manager',
            timezone: 'Asia/Shanghai',
            createdAt: now,
        });
        await testDb.insert(schema.inspections).values({
            id: 'inspection-r1',
            tenantId: TENANT,
            inspectorId: INSPECTOR,
            propertyAddress: '9 Route St',
            date: '2026-07-01',
            status: 'scheduled',
            paymentStatus: 'unpaid',
            price: 0,
            paymentRequired: false,
            agreementRequired: false,
            createdAt: now,
        });
        await testDb.insert(schema.eventTypes).values({
            id: 'event-type-r1',
            tenantId: TENANT,
            name: 'Radon pickup',
            slug: 'radon-pickup',
            defaultDurationMin: 60,
            defaultPriceCents: 0,
            color: '#6366f1',
            sortOrder: 0,
            active: true,
            createdAt: now,
        });
        await testDb.insert(schema.inspectionEvents).values({
            id: 'event-r1',
            tenantId: TENANT,
            inspectionId: 'inspection-r1',
            eventTypeId: 'event-type-r1',
            inspectorId: INSPECTOR,
            scheduledAt: new Date('2026-07-17T20:00:00.000Z'),
            durationMin: 60,
            priceCents: 0,
            status: 'scheduled',
            createdAt: now,
        });

        const { app, env } = buildApp(MANAGER, 'manager');
        const response = await app.request(
            `/api/calendar/items?start=2026-07-13&end=2026-07-20&userId=${INSPECTOR}`,
            {},
            env,
        );
        expect(response.status).toBe(200);
        const body = (await response.json()) as {
            data: { items: Array<{ kind: string; civilDate: string; startTime?: string }> };
        };
        const event = body.data.items.find((item) => item.kind === 'inspection_event');
        // Shanghai (UTC+8) → 2026-07-18 04:00, not New York (UTC-4) 2026-07-17 16:00.
        expect(event).toMatchObject({ civilDate: '2026-07-18', startTime: '04:00' });
    });

    /**
     * A radon pickup is not entered, it is COMPUTED: the sample sits for at
     * least 48 hours, so the pickup instant is `dropOff + 48h`. That is plain
     * millisecond arithmetic, which means the two things below are both true and
     * neither is obvious — and the calendar is where a human finds out.
     *
     * Spring-forward 2027 in the US is 2027-03-14. A drop-off at 09:00 EST on
     * 2027-03-13 is 14:00Z; exactly 48h later is 14:00Z on 2027-03-15, which in
     * New York is 10:00 EDT. The wall clock MOVED. Anyone re-deriving the day or
     * the hour from the UTC instant (`start.toISOString().slice(0, 10)`) gets
     * this wrong in both directions, which is why the civil parts are resolved
     * server-side in the viewer's zone and never recomputed downstream.
     */
    async function seedComputedPickup(scheduledAt: Date, id: string) {
        const now = new Date();
        await testDb.insert(schema.inspections).values({
            id: `inspection-${id}`,
            tenantId: TENANT,
            inspectorId: INSPECTOR,
            propertyAddress: '9 Radon Way',
            date: '2027-03-13',
            status: 'scheduled',
            paymentStatus: 'unpaid',
            price: 0,
            paymentRequired: false,
            agreementRequired: false,
            createdAt: now,
        });
        await testDb.insert(schema.eventTypes).values({
            id: `event-type-${id}`,
            tenantId: TENANT,
            name: 'Radon pickup',
            slug: `radon-pickup-${id}`,
            defaultDurationMin: 20,
            defaultPriceCents: 0,
            color: '#6366f1',
            sortOrder: 0,
            active: true,
            createdAt: now,
        });
        await testDb.insert(schema.inspectionEvents).values({
            id: `event-${id}`,
            tenantId: TENANT,
            inspectionId: `inspection-${id}`,
            eventTypeId: `event-type-${id}`,
            inspectorId: INSPECTOR,
            scheduledAt,
            durationMin: 20,
            priceCents: 0,
            status: 'scheduled',
            createdAt: now,
        });
    }

    async function pickupItem() {
        const items = await listCalendarItems({} as D1Database, TENANT, {
            start: '2027-03-12',
            end: '2027-03-16',
            userIds: [INSPECTOR],
            effectiveTz: 'America/New_York',
        });
        return items.find((item) => item.kind === 'inspection_event');
    }

    it('reports the shifted wall clock when a 48h pickup crosses spring-forward', async () => {
        // 2027-03-13 09:00 EST = 14:00Z. +48h = 2027-03-15T14:00Z = 10:00 EDT.
        const dropOff = new Date('2027-03-13T14:00:00.000Z');
        await seedComputedPickup(new Date(dropOff.getTime() + 48 * 3_600_000), 'dst');

        expect(await pickupItem()).toMatchObject({
            civilDate: '2027-03-15',
            // NOT '09:00'. Adding 48 hours of elapsed time across a DST boundary
            // does not preserve the hour, and the calendar must show the hour the
            // inspector will actually be standing there.
            startTime: '10:00',
        });
    });

    it('keeps a late-evening pickup on its own civil day in a UTC-negative zone', async () => {
        // 2027-03-15T02:00Z is 2027-03-14 22:00 in New York. Slicing the ISO
        // instant would file this under the 15th — a whole day early, on the
        // other side of the boundary from the UTC-positive case above.
        await seedComputedPickup(new Date('2027-03-15T02:00:00.000Z'), 'eve');

        expect(await pickupItem()).toMatchObject({
            civilDate: '2027-03-14',
            startTime: '22:00',
        });
    });
});
