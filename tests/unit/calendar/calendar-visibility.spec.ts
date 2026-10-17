/**
 * The calendar, the week summary, availability and calendar blocks against the inspection list's
 * scope. Two rules are pinned here:
 *   - opening ANOTHER person's calendar needs `scheduleOthers` (or an owner/manager role), and a
 *     restricted inspector never holds it;
 *   - whatever the feed returns for a restricted caller is a subset of the inspection list: a stale
 *     `inspector_id` the roster has overruled, and a visit on an inspection they cannot open, never
 *     appear.
 * Every restriction is paired with a control that goes through.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { drizzle } from 'drizzle-orm/d1';
import { and, eq } from 'drizzle-orm';
import { createTestDb, setupSchema } from '../db';
import { asD1DrizzleReturn, asScopedDbSource } from '../helpers/test-db';
import * as schema from '../../../server/lib/db/schema';
import { ScopedDB } from '../../../server/lib/db/scoped';
import calendarItemsRoutes from '../../../server/api/calendar-items';
import calendarBlocksRoutes from '../../../server/api/calendar-blocks';
import { availabilityRoutes } from '../../../server/api/availability';
import weekSummaryRoutes from '../../../server/api/schedule-week-summary';
import { AppError } from '../../../server/lib/errors';
import { visibleInspectionsCondition } from '../../../server/lib/inspection/visibility';
import { seedVisibilityFixture, TENANT, USERS, INSP, VISIBLE_TO_A } from '../helpers/visibility-fixture';
import type { HonoConfig } from '../../../server/types/hono';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

type Role = 'owner' | 'manager' | 'inspector';
const TODAY = new Date().toISOString().slice(0, 10);

describe('calendar surfaces honour the scope', () => {
    let db: ReturnType<typeof createTestDb>['db'];
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];

    beforeEach(async () => {
        const f = createTestDb(); db = f.db; sqlite = f.sqlite;
        await setupSchema(f.sqlite); await seedVisibilityFixture(db);
        vi.mocked(drizzle).mockReturnValue(asD1DrizzleReturn(db));
        const now = new Date();
        await db.insert(schema.eventTypes).values({ id: 'et-1', tenantId: TENANT, name: 'Radon', slug: 'radon', createdAt: now });
        // A visit on a hidden inspection that NAMES inspA, and one on a visible inspection.
        await db.insert(schema.inspectionEvents).values([
            { id: 'ev-hidden', tenantId: TENANT, inspectionId: INSP.other, eventTypeId: 'et-1', inspectorId: USERS.inspA, scheduledAt: new Date(`${TODAY}T15:00:00Z`), durationMin: 30, createdAt: now },
            { id: 'ev-own', tenantId: TENANT, inspectionId: INSP.own, eventTypeId: 'et-1', inspectorId: USERS.inspA, scheduledAt: new Date(`${TODAY}T16:00:00Z`), durationMin: 30, createdAt: now },
        ]);
        // inspB has weekly hours; inspA and inspAll have none, so a summary of inspB differs from a summary of the caller.
        await db.insert(schema.availability).values([1, 2, 3, 4, 5].map((dayOfWeek) => ({
            id: `av-b-${dayOfWeek}`, tenantId: TENANT, inspectorId: USERS.inspB, dayOfWeek, startTime: '08:00', endTime: '10:00', createdAt: now,
        })));
        await db.insert(schema.calendarBlocks).values({
            id: 'blk-b', tenantId: TENANT, userId: USERS.inspB, title: 'Colleague time off', date: TODAY, allDay: true, createdAt: now, updatedAt: now,
        });
        await db.insert(schema.tenantConfigs).values({ tenantId: TENANT, updatedAt: now });
    });
    afterEach(() => { sqlite.close(); });

    function build(userId: string, role: Role) {
        const app = new OpenAPIHono<HonoConfig>();
        app.onError((err, c) => err instanceof AppError
            ? c.json({ success: false, error: { code: err.code, message: err.message } }, err.status)
            : c.json({ success: false, error: { message: String(err) } }, 500));
        app.use('*', async (c, next) => {
            c.set('userRole', role);
            c.set('user', { sub: userId, role, tenantId: TENANT } as never);
            c.set('tenantId', TENANT);
            c.set('sdb', new ScopedDB(asScopedDbSource(db), TENANT));
            c.set('services', { availability: {} } as never);
            await next();
        });
        app.route('/api/calendar', calendarItemsRoutes);
        app.route('/api/calendar', calendarBlocksRoutes);
        app.route('/api/availability', availabilityRoutes);
        app.route('/api/schedule', weekSummaryRoutes);
        return app;
    }
    const get = async (app: OpenAPIHono<HonoConfig>, p: string) => {
        const res = await app.request(p, {}, { DB: {} } as never);
        return { status: res.status, body: await res.json() as { data?: any } }; // eslint-disable-line @typescript-eslint/no-explicit-any
    };
    const grant = (userId: string, overrides: Record<string, boolean>) =>
        db.update(schema.users).set({ permissionOverrides: overrides }).where(eq(schema.users.id, userId));
    const range = `start=${TODAY}&end=${TODAY}`;
    const items = async (app: OpenAPIHono<HonoConfig>, extra = '') => {
        const r = await get(app, `/api/calendar/items?${range}${extra}`);
        expect(r.status).toBe(200);
        return r.body.data.items as Array<{ id: string; kind: string; inspectionId?: string }>;
    };

    describe('opening another person\'s calendar', () => {
        it('an inspector without scheduleOthers is refused (control for the grant below)', async () => {
            expect((await get(build(USERS.inspAll, 'inspector'), `/api/calendar/items?${range}&userId=${USERS.inspB}`)).status).toBe(403);
        });
        it('an unrestricted inspector granted scheduleOthers sees the colleague\'s jobs', async () => {
            await grant(USERS.inspAll, { scheduleOthers: true });
            const got = await items(build(USERS.inspAll, 'inspector'), `&userId=${USERS.inspB}`);
            expect(got.filter(i => i.kind === 'inspection').map(i => i.id).sort()).toEqual([INSP.other, INSP.stale, INSP.team].sort());
        });
        it('a restricted inspector granted scheduleOthers is still refused: the grant is switched off with the scope', async () => {
            await grant(USERS.inspA, { viewAllInspections: false, scheduleOthers: true });
            expect((await get(build(USERS.inspA, 'inspector'), `/api/calendar/items?${range}&userId=${USERS.inspB}`)).status).toBe(403);
            expect((await get(build(USERS.inspA, 'inspector'), `/api/calendar/items?${range}&userIds=${USERS.inspA},${USERS.inspB}`)).status).toBe(403);
        });
        it('owner and manager may select anyone (control)', async () => {
            for (const [id, role] of [[USERS.owner, 'owner'], [USERS.manager, 'manager']] as const) {
                const got = await items(build(id, role), `&userId=${USERS.inspB}`);
                expect(got.some(i => i.id === INSP.other)).toBe(true);
            }
        });
    });

    describe('what a restricted inspector\'s feed contains', () => {
        beforeEach(async () => { await grant(USERS.inspA, { viewAllInspections: false }); });

        it('inspections are exactly the inspection list\'s set for that day: the stale assignment never appears', async () => {
            const got = (await items(build(USERS.inspA, 'inspector'))).filter(i => i.kind === 'inspection').map(i => i.id).sort();
            expect(got).toEqual([...VISIBLE_TO_A].sort());
            expect(got).not.toContain(INSP.stale);
            // The invariant, stated against the list itself rather than a literal.
            const list = (await db.select({ id: schema.inspections.id }).from(schema.inspections).where(and(
                eq(schema.inspections.tenantId, TENANT),
                visibleInspectionsCondition(db as never, { kind: 'assigned', userId: USERS.inspA }, TENANT),
            ))).map(r => r.id);
            expect(got.every(id => list.includes(id))).toBe(true);
        });
        it('a visit on an inspection outside the set is dropped even though it names the caller; one inside stays', async () => {
            const visits = (await items(build(USERS.inspA, 'inspector'))).filter(i => i.kind === 'inspection_event');
            expect(visits.map(i => i.id)).toEqual(['ev-own']);
            expect(visits.map(i => i.inspectionId)).not.toContain(INSP.other);
        });
        it('control: the unrestricted caller and the owner still see the stale assignment and both visits', async () => {
            await grant(USERS.inspAll, { scheduleOthers: true });
            const all = await items(build(USERS.inspAll, 'inspector'), `&userId=${USERS.inspA}`);
            expect(all.filter(i => i.kind === 'inspection').map(i => i.id)).toContain(INSP.stale);
            expect(all.filter(i => i.kind === 'inspection_event').map(i => i.id).sort()).toEqual(['ev-hidden', 'ev-own']);
            const owner = await items(build(USERS.owner, 'owner'), `&userId=${USERS.inspA}`);
            expect(owner.filter(i => i.kind === 'inspection_event')).toHaveLength(2);
        });
        it('the dispatch board stays closed to a restricted caller', async () => {
            expect((await get(build(USERS.inspA, 'inspector'), `/api/calendar/dispatch?date=${TODAY}`)).status).toBe(403);
        });
    });

    describe('week summary', () => {
        const START = '2026-08-03'; // a Monday
        const statuses = async (app: OpenAPIHono<HonoConfig>, extra = '') => {
            const r = await get(app, `/api/schedule/week-summary?start=${START}${extra}`);
            expect(r.status).toBe(200);
            return (r.body.data.days as Array<{ date: string; status: string }>).map(d => d.status);
        };
        it('control: the owner asking for inspB sees configured weekdays', async () => {
            expect((await statuses(build(USERS.owner, 'owner'), `&userId=${USERS.inspB}`))[0]).not.toBe('unconfigured');
        });
        it('a restricted inspector asking for inspB is summarized against themselves (no hours configured)', async () => {
            await grant(USERS.inspA, { viewAllInspections: false, scheduleOthers: true });
            expect((await statuses(build(USERS.inspA, 'inspector'), `&userId=${USERS.inspB}`)).every(s => s === 'unconfigured' || s === 'closed')).toBe(true);
        });
        it('an unrestricted inspector without scheduleOthers is also pinned to themselves', async () => {
            expect((await statuses(build(USERS.inspAll, 'inspector'), `&userId=${USERS.inspB}`)).every(s => s === 'unconfigured' || s === 'closed')).toBe(true);
        });
        it('the same inspector granted scheduleOthers may summarize inspB (the behaviour change)', async () => {
            await grant(USERS.inspAll, { scheduleOthers: true });
            expect((await statuses(build(USERS.inspAll, 'inspector'), `&userId=${USERS.inspB}`))[0]).not.toBe('unconfigured');
        });
    });

    describe('availability and calendar blocks', () => {
        it('reading another inspector needs scheduleOthers or an administrator role', async () => {
            expect((await get(build(USERS.inspAll, 'inspector'), `/api/availability?inspectorId=${USERS.inspB}`)).status).toBe(403);
            expect((await get(build(USERS.inspAll, 'inspector'), `/api/calendar/blocks?start=${TODAY}&end=${TODAY}&userId=${USERS.inspB}`)).status).toBe(403);
            await grant(USERS.inspAll, { scheduleOthers: true });
            expect((await get(build(USERS.inspAll, 'inspector'), `/api/availability?inspectorId=${USERS.inspB}`)).status).toBe(200);
            const blocks = await get(build(USERS.inspAll, 'inspector'), `/api/calendar/blocks?start=${TODAY}&end=${TODAY}&userId=${USERS.inspB}`);
            expect(blocks.status).toBe(200);
            expect(blocks.body.data.blocks).toHaveLength(1);
        });
        it('a restricted inspector is refused even when granted scheduleOthers', async () => {
            await grant(USERS.inspA, { viewAllInspections: false, scheduleOthers: true });
            expect((await get(build(USERS.inspA, 'inspector'), `/api/availability?inspectorId=${USERS.inspB}`)).status).toBe(403);
            expect((await get(build(USERS.inspA, 'inspector'), `/api/availability/overrides?inspectorId=${USERS.inspB}`)).status).toBe(403);
            expect((await get(build(USERS.inspA, 'inspector'), `/api/calendar/blocks?start=${TODAY}&end=${TODAY}&userId=${USERS.inspB}`)).status).toBe(403);
        });
        it('control: a restricted inspector reads their own', async () => {
            await grant(USERS.inspA, { viewAllInspections: false });
            expect((await get(build(USERS.inspA, 'inspector'), `/api/availability`)).status).toBe(200);
            expect((await get(build(USERS.inspA, 'inspector'), `/api/calendar/blocks?start=${TODAY}&end=${TODAY}`)).status).toBe(200);
        });
    });
});
