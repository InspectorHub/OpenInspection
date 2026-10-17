/**
 * Invoices, scheduled visits, inspection requests, tag listings, SMS consent and the calendar's
 * local events: each reaches inspection-derived rows by a path of its own, so each is checked here
 * against the shared fixture. Every restriction is paired with a control that goes through.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { createTestDb, setupSchema } from '../db';
import { asD1DrizzleReturn, asScopedDbSource } from '../helpers/test-db';
import * as schema from '../../../server/lib/db/schema';
import { ScopedDB } from '../../../server/lib/db/scoped';
import { InvoiceService } from '../../../server/services/invoice.service';
import { InspectionRequestService } from '../../../server/services/inspection-request.service';
import invoiceRoutes from '../../../server/api/invoices';
import eventsRoutes from '../../../server/api/events';
import inspectionRequestsRoutes from '../../../server/api/inspection-requests';
import tagsRoutes from '../../../server/api/tags';
import calendarEventsRoutes from '../../../server/api/calendar-events';
import { smsAdminRoutes } from '../../../server/api/sms';
import { AppError } from '../../../server/lib/errors';
import { seedVisibilityFixture, TENANT, USERS, INSP, VISIBLE_TO_A, ALL_OF_TENANT } from '../helpers/visibility-fixture';
import type { HonoConfig } from '../../../server/types/hono';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

type Role = 'owner' | 'manager' | 'inspector';

describe('other inspection-derived reads honour the scope', () => {
    let db: ReturnType<typeof createTestDb>['db'];

    beforeEach(async () => {
        const f = createTestDb(); db = f.db; await setupSchema(f.sqlite); await seedVisibilityFixture(db);
        vi.mocked(drizzle).mockReturnValue(asD1DrizzleReturn(db));
        // inspA is restricted and also holds the company-finance switch, which is what opens the invoice routes to an inspector.
        await db.update(schema.users).set({ permissionOverrides: { viewAllInspections: false, companyFinance: true } }).where(eq(schema.users.id, USERS.inspA));
        await db.update(schema.users).set({ permissionOverrides: { companyFinance: true } }).where(eq(schema.users.id, USERS.inspAll));
    });

    function build(userId: string, role: Role, services: Record<string, unknown>, mount: string, router: unknown) {
        const app = new OpenAPIHono<HonoConfig>();
        app.onError((err, c) => err instanceof AppError
            ? c.json({ success: false, error: { code: err.code, message: err.message } }, err.status)
            : c.json({ success: false, error: { message: String(err) } }, 500));
        app.use('*', async (c, next) => {
            c.set('userRole', role);
            c.set('user', { sub: userId, role, tenantId: TENANT } as never);
            c.set('tenantId', TENANT);
            c.set('sdb', new ScopedDB(asScopedDbSource(db), TENANT));
            c.set('services', services as never);
            await next();
        });
        app.route(mount, router as never);
        return app;
    }
    const send = async (app: OpenAPIHono<HonoConfig>, p: string, init?: RequestInit) => {
        const res = await app.request(p, init, { DB: {}, JWT_SECRET: 'x' } as never);
        return { status: res.status, body: await res.json().catch(() => null) as { data?: unknown } | null };
    };
    const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

    describe('invoices', () => {
        beforeEach(async () => {
            const inv = (id: string, inspectionId: string | null) => ({
                id, tenantId: TENANT, inspectionId, amountCents: 1000, lineItems: [], createdAt: new Date(), invoiceNumber: `N-${id}`,
            });
            await db.insert(schema.invoices).values([
                inv('inv-own', INSP.own), inv('inv-team', INSP.team), inv('inv-other', INSP.other), inv('inv-none', null),
            ] as never);
        });
        const services = () => ({ invoice: new InvoiceService({} as D1Database) });
        const ids = (r: { body: { data?: unknown } | null }) => (r.body?.data as Array<{ id: string }>).map(i => i.id).sort();

        it('the list is cut to the invoices of visible inspections', async () => {
            const r = await send(build(USERS.inspA, 'inspector', services(), '/api/invoices', invoiceRoutes), '/api/invoices');
            expect(r.status).toBe(200);
            expect(ids(r)).toEqual(['inv-own', 'inv-team']);
        });
        it('control: owner, manager and an unrestricted inspector with the same switch see every invoice', async () => {
            for (const [u, role] of [[USERS.owner, 'owner'], [USERS.manager, 'manager'], [USERS.inspAll, 'inspector']] as const) {
                const r = await send(build(u, role, services(), '/api/invoices', invoiceRoutes), '/api/invoices');
                expect(ids(r), u).toEqual(['inv-none', 'inv-other', 'inv-own', 'inv-team']);
            }
        });
        it('the payment ledger: a hidden or attached-to-nothing invoice is a 404, a visible one answers', async () => {
            const stub = { invoice: { listPayments: async () => [] } };
            const app = build(USERS.inspA, 'inspector', stub, '/api/invoices', invoiceRoutes);
            expect((await send(app, '/api/invoices/inv-own/payments')).status).toBe(200);
            const hidden = await send(app, '/api/invoices/inv-other/payments');
            const none = await send(app, '/api/invoices/inv-none/payments');
            const missing = await send(app, '/api/invoices/no-such-invoice/payments');
            expect([hidden.status, none.status, missing.status]).toEqual([404, 404, 404]);
            expect(none).toEqual(hidden);
            expect(missing).toEqual(hidden);
            // writes are refused the same way, and reach no service
            const recorded = vi.fn();
            const writer = build(USERS.inspA, 'inspector', { invoice: { recordOfflinePayment: recorded } }, '/api/invoices', invoiceRoutes);
            const body = { amountCents: 100, method: 'cash', occurredAt: new Date(Date.now() - 1000).toISOString() };
            expect((await send(writer, '/api/invoices/inv-other/payments', json('POST', body))).status).toBe(404);
            expect(recorded).not.toHaveBeenCalled();
        });
    });

    describe('scheduled visits', () => {
        beforeEach(async () => {
            await db.insert(schema.eventTypes).values({ id: 'et-1', tenantId: TENANT, name: 'Radon', slug: 'radon', createdAt: new Date() } as never);
            const ev = (id: string, inspectionId: string) => ({
                id, tenantId: TENANT, inspectionId, eventTypeId: 'et-1', scheduledAt: new Date(), durationMin: 30, status: 'scheduled', createdAt: new Date(),
            });
            await db.insert(schema.inspectionEvents).values([ev('ev-own', INSP.own), ev('ev-other', INSP.other)] as never);
        });
        const statusOf = async (id: string) => (await db.select({ s: schema.inspectionEvents.status }).from(schema.inspectionEvents).where(eq(schema.inspectionEvents.id, id)).get())?.s;
        const put = (userId: string, role: Role, id: string) => send(
            build(userId, role, { event: { updateEventStatus: async (_t: string, eid: string, status: string) => { await db.update(schema.inspectionEvents).set({ status: status as never }).where(eq(schema.inspectionEvents.id, eid)); } } }, '/api', eventsRoutes),
            `/api/events/${id}`, json('PUT', { status: 'completed' }));

        it('a visit of a hidden inspection is a 404 and stays untouched; a visit of an assigned one is updated', async () => {
            expect((await put(USERS.inspA, 'inspector', 'ev-other')).status).toBe(404);
            expect(await statusOf('ev-other')).toBe('scheduled');
            expect((await put(USERS.inspA, 'inspector', 'ev-missing')).status).toBe(404);
            expect((await put(USERS.inspA, 'inspector', 'ev-own')).status).toBe(200);
            expect(await statusOf('ev-own')).toBe('completed');
        });
        it('control: a manager can complete any visit', async () => {
            expect((await put(USERS.manager, 'manager', 'ev-other')).status).toBe(200);
        });
    });

    describe('inspection requests', () => {
        beforeEach(async () => {
            const req = (id: string, name: string) => ({
                id, tenantId: TENANT, clientName: name, propertyAddress: `${id} Road`, scheduledAt: new Date(), status: 'pending', createdAt: new Date(), updatedAt: new Date(),
            });
            await db.insert(schema.inspectionRequests).values([req('rq-own', 'Alice'), req('rq-other', 'Bob'), req('rq-empty', 'Carol')] as never);
            await db.update(schema.inspections).set({ requestId: 'rq-own' }).where(eq(schema.inspections.id, INSP.own));
            await db.update(schema.inspections).set({ requestId: 'rq-other' }).where(eq(schema.inspections.id, INSP.other));
        });
        const services = () => ({ inspectionRequest: new InspectionRequestService({} as D1Database) });
        const app = (u: string, role: Role) => build(u, role, services(), '/api/inspection-requests', inspectionRequestsRoutes);

        it('the list holds only requests with a visible inspection, and each shows only the visible inspections', async () => {
            const r = await send(app(USERS.inspA, 'inspector'), '/api/inspection-requests');
            const requests = (r.body?.data as { requests: Array<{ id: string; inspections: Array<{ id: string }> }> }).requests;
            expect(requests.map(x => x.id)).toEqual(['rq-own']);
            expect(requests[0]!.inspections.map(i => i.id)).toEqual([INSP.own]);
        });
        it('control: a manager sees all three', async () => {
            const r = await send(app(USERS.manager, 'manager'), '/api/inspection-requests');
            expect((r.body?.data as { requests: unknown[] }).requests.length).toBe(3);
        });
        it('detail: a request with nothing visible answers like a missing one', async () => {
            const hidden = await send(app(USERS.inspA, 'inspector'), '/api/inspection-requests/rq-other');
            const empty = await send(app(USERS.inspA, 'inspector'), '/api/inspection-requests/rq-empty');
            const missing = await send(app(USERS.inspA, 'inspector'), '/api/inspection-requests/no-such-request');
            expect([hidden.status, empty.status, missing.status]).toEqual([404, 404, 404]);
            expect(empty).toEqual(hidden);
            expect(missing).toEqual(hidden);
            expect((await send(app(USERS.inspA, 'inspector'), '/api/inspection-requests/rq-own')).status).toBe(200);
        });
        it('by-inspection: a hidden or absent inspection is a 404; a visible one resolves its request', async () => {
            const a = app(USERS.inspA, 'inspector');
            expect((await send(a, `/api/inspection-requests/by-inspection/${INSP.other}`)).status).toBe(404);
            expect((await send(a, '/api/inspection-requests/by-inspection/no-such-inspection')).status).toBe(404);
            const own = await send(a, `/api/inspection-requests/by-inspection/${INSP.own}`);
            expect(own.status).toBe(200);
            expect((own.body?.data as { request: { id: string } }).request.id).toBe('rq-own');
        });
    });

    describe('tag listings', () => {
        const tag = { get: async () => ({ id: 'tg-1' }), listInspectionsByTag: async () => [...ALL_OF_TENANT] };
        it('lists only the visible inspections of a tag', async () => {
            const r = await send(build(USERS.inspA, 'inspector', { tag }, '/api/tags', tagsRoutes), '/api/tags/tg-1/inspections');
            expect((r.body?.data as { inspectionIds: string[] }).inspectionIds.sort()).toEqual([...VISIBLE_TO_A].sort());
        });
        it('control: a manager gets the whole list', async () => {
            const r = await send(build(USERS.manager, 'manager', { tag }, '/api/tags', tagsRoutes), '/api/tags/tg-1/inspections');
            expect((r.body?.data as { inspectionIds: string[] }).inspectionIds.length).toBe(ALL_OF_TENANT.length);
        });
    });

    describe('SMS consent status', () => {
        it('a hidden or absent inspection is a 404; a visible one answers', async () => {
            const a = build(USERS.inspA, 'inspector', {}, '/api/admin', smsAdminRoutes);
            expect((await send(a, `/api/admin/sms/consent?inspectionId=${INSP.other}`)).status).toBe(404);
            expect((await send(a, '/api/admin/sms/consent?inspectionId=no-such-inspection')).status).toBe(404);
            expect((await send(a, `/api/admin/sms/consent?inspectionId=${INSP.own}`)).status).toBe(200);
        });
    });

    describe('calendar events', () => {
        it('local events are cut to the visible inspections', async () => {
            const today = new Date().toISOString().slice(0, 10);
            const next = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
            const url = `/api/calendar/events?start=${today}&end=${next}`;
            const mine = await send(build(USERS.inspA, 'inspector', {}, '/api/calendar/events', calendarEventsRoutes), url);
            expect(mine.status).toBe(200);
            const idsOf = (r: { body: unknown }) => (r.body as Array<{ id: string }>).map(e => e.id).sort();
            expect(idsOf(mine)).toEqual([...VISIBLE_TO_A].sort());
            const all = await send(build(USERS.manager, 'manager', {}, '/api/calendar/events', calendarEventsRoutes), url);
            expect(idsOf(all)).toEqual([...ALL_OF_TENANT].sort());
        });
    });
});
