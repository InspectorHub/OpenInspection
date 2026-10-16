/**
 * Staff move and reassign inspections, and do nothing else to them.
 *
 * `staff` is evaluated at the inspector tier, so every `requireRole('owner',
 * 'manager', 'inspector')` gate admits it. These specs pin the two actions staff
 * keep (reschedule the date/time, reassign the inspector or roster) and the
 * refusals around them (create, copy, delete, any other field of the
 * inspection). They run against the real routes through `app.request`, so a
 * regression in route wiring goes red, not only one in a helper.
 *
 * Both allowed actions stay behind the `scheduleOthers` capability, which staff
 * hold by default; each is paired with the same call made with it switched off.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { HonoConfig } from '../../../server/types/hono';
import type { UserRole } from '../../../server/types/auth';
import { AppError, Errors } from '../../../server/lib/errors';
import { INSPECTION_STATUS } from '../../../server/lib/status/inspection-status';
import { REPORT_STATUS } from '../../../server/lib/status/report-status';
import { UpdateInspectionSchema } from '../../../server/lib/validations/inspection.schema';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

// eslint-disable-next-line import/order
import { inspectionsRoutes } from '../../../server/api/inspections';

const TENANT = '00000000-0000-0000-0000-000000000001';
const ACTOR = '00000000-0000-0000-0000-000000000099';
const LEAD_A = '00000000-0000-0000-0000-0000000000a1';
const LEAD_B = '00000000-0000-0000-0000-0000000000b2';
const INSP_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const START_MS = Date.UTC(2026, 5, 1, 9, 0, 0);
const FAKE_ENV = { DB: {} } as HonoConfig['Bindings'];

type Overrides = Record<string, boolean> | null;

describe('staff on the inspection routes', () => {
    let db: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db as BetterSQLite3Database<typeof schema>;
        await setupSchema(fixture.sqlite);
        await db.insert(schema.tenants).values({
            id: TENANT, slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await db.insert(schema.users).values([
            { id: ACTOR, tenantId: TENANT, email: 'actor@example.com', passwordHash: 'h', createdAt: new Date() },
            { id: LEAD_A, tenantId: TENANT, email: 'a@example.com', passwordHash: 'h', createdAt: new Date() },
            { id: LEAD_B, tenantId: TENANT, email: 'b@example.com', passwordHash: 'h', createdAt: new Date() },
        ]);
        await db.insert(schema.tenantConfigs).values({ tenantId: TENANT, defaultTimezone: 'UTC', updatedAt: new Date() });
        await db.insert(schema.inspections).values({
            id: INSP_ID, tenantId: TENANT, propertyAddress: '1 Main St', date: '2026-06-01', inspectorId: LEAD_A,
            status: INSPECTION_STATUS.SCHEDULED, reportStatus: REPORT_STATUS.IN_PROGRESS, paymentStatus: 'unpaid',
            price: 0, paymentRequired: false, agreementRequired: false, createdAt: new Date(),
        });
    });

    function buildApp(role: UserRole, overrides: Overrides = null) {
        (mockDrizzle as ReturnType<typeof vi.fn>).mockReturnValue(db);
        const app = new OpenAPIHono<HonoConfig>();
        app.onError((err, c) => {
            if (err instanceof AppError) {
                return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status);
            }
            return c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500);
        });
        app.use('*', async (c, next) => {
            c.set('tenantId', TENANT);
            c.set('userRole', role);
            c.set('user', { sub: ACTOR, role, tenantId: TENANT });
            c.set('sdb', {
                getById: async () => ({ permissionOverrides: overrides }),
            } as unknown as HonoConfig['Variables']['sdb']);
            c.set('services', {
                inspection: {
                    getInspection: async (id: string) => {
                        const inspection = await db.select().from(schema.inspections).where(eq(schema.inspections.id, id)).get();
                        if (!inspection) throw Errors.NotFound('Inspection not found');
                        return { inspection };
                    },
                    // Reaching either of these means the route's middleware let the caller through.
                    cloneInspection: async () => { throw Errors.NotFound('reached the clone handler'); },
                },
            } as unknown as HonoConfig['Variables']['services']);
            await next();
        });
        app.route('/api/inspections', inspectionsRoutes);
        return app;
    }

    const send = (app: ReturnType<typeof buildApp>, method: string, path: string, body?: unknown) =>
        app.request(`/api/inspections${path}`, {
            method,
            headers: { 'Content-Type': 'application/json' },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }, FAKE_ENV);

    const readRow = () => db.select().from(schema.inspections).where(eq(schema.inspections.id, INSP_ID)).get();

    describe('reschedule: PATCH /:id/schedule', () => {
        it('staff move the date and time (scheduleOthers is on for staff by default)', async () => {
            const res = await send(buildApp('staff'), 'PATCH', `/${INSP_ID}/schedule`, { scheduledStartMs: START_MS });
            expect(res.status).toBe(200);
            expect((await readRow())?.scheduledStartMs?.getTime()).toBe(START_MS);
        });

        it('staff are refused when scheduleOthers is switched off for them, and nothing changes', async () => {
            const res = await send(buildApp('staff', { scheduleOthers: false }), 'PATCH', `/${INSP_ID}/schedule`, { scheduledStartMs: START_MS });
            expect(res.status).toBe(403);
            expect((await readRow())?.scheduledStartMs).toBeNull();
        });
    });

    describe('reassign: PATCH /:id/schedule with a lead, and PATCH /:id with an inspector', () => {
        it('staff reassign the roster through the schedule route', async () => {
            const res = await send(buildApp('staff'), 'PATCH', `/${INSP_ID}/schedule`, { scheduledStartMs: START_MS, leadInspectorId: LEAD_B });
            expect(res.status).toBe(200);
            expect((await readRow())?.inspectorId).toBe(LEAD_B);
        });

        it('staff are refused reassigning when scheduleOthers is off', async () => {
            const res = await send(buildApp('staff', { scheduleOthers: false }), 'PATCH', `/${INSP_ID}/schedule`, { scheduledStartMs: START_MS, leadInspectorId: LEAD_B });
            expect(res.status).toBe(403);
            expect((await readRow())?.inspectorId).toBe(LEAD_A);
        });

        it('staff reassign through PATCH /:id with the inspector field', async () => {
            const res = await send(buildApp('staff'), 'PATCH', `/${INSP_ID}`, { inspectorId: LEAD_B });
            expect(res.status).toBe(200);
            expect((await readRow())?.inspectorId).toBe(LEAD_B);
        });

        it('staff change the date through PATCH /:id', async () => {
            const res = await send(buildApp('staff'), 'PATCH', `/${INSP_ID}`, { date: '2026-06-09' });
            expect(res.status).toBe(200);
            expect((await readRow())?.date.slice(0, 10)).toBe('2026-06-09');
        });

        it('PATCH /:id refuses staff the date or the inspector when scheduleOthers is off', async () => {
            const app = buildApp('staff', { scheduleOthers: false });
            expect((await send(app, 'PATCH', `/${INSP_ID}`, { inspectorId: LEAD_B })).status).toBe(403);
            expect((await send(app, 'PATCH', `/${INSP_ID}`, { date: '2026-06-09' })).status).toBe(403);
            const row = await readRow();
            expect(row?.inspectorId).toBe(LEAD_A);
            expect(row?.date.slice(0, 10)).toBe('2026-06-01');
        });
    });

    describe('everything else on an inspection is refused to staff', () => {
        it('PATCH /:id refuses any other field, even next to an allowed one, and writes nothing', async () => {
            const app = buildApp('staff');
            expect((await send(app, 'PATCH', `/${INSP_ID}`, { propertyAddress: '99 Elm Street' })).status).toBe(403);
            expect((await send(app, 'PATCH', `/${INSP_ID}`, { date: '2026-06-09', propertyAddress: '99 Elm Street' })).status).toBe(403);
            const row = await readRow();
            expect(row?.propertyAddress).toBe('1 Main St');
            expect(row?.date.slice(0, 10)).toBe('2026-06-01');
        });

        it('PATCH /:id refuses staff every field the schema accepts except date and inspectorId, one at a time', async () => {
            const fields = Object.keys(UpdateInspectionSchema.shape).filter((k) => k !== 'date' && k !== 'inspectorId');
            // A schema that lost its fields would turn this into a loop over nothing.
            expect(fields.length).toBeGreaterThan(10);
            const app = buildApp('staff');
            const allowed: string[] = [];
            for (const field of fields) {
                const res = await send(app, 'PATCH', `/${INSP_ID}`, { [field]: null });
                if (res.status !== 403) allowed.push(`${field}:${res.status}`);
            }
            expect(allowed).toEqual([]);
            const row = await readRow();
            expect(row?.propertyAddress).toBe('1 Main St');
        });

        it('control: the same fields are not refused for an inspector (the loop above is not a blanket 403)', async () => {
            const app = buildApp('inspector');
            const res = await send(app, 'PATCH', `/${INSP_ID}`, { propertyAddress: '2 Oak Street' });
            expect(res.status).toBe(200);
        });

        it('control: an inspector on the same inspection can still edit another field', async () => {
            const res = await send(buildApp('inspector'), 'PATCH', `/${INSP_ID}`, { propertyAddress: '99 Elm Street' });
            expect(res.status).toBe(200);
            expect((await readRow())?.propertyAddress).toBe('99 Elm Street');
        });

        it('creating an inspection is refused (plain create and the wizard); an inspector reaches validation', async () => {
            expect((await send(buildApp('staff'), 'POST', '', {})).status).toBe(403);
            expect((await send(buildApp('staff'), 'POST', '/wizard', {})).status).toBe(403);
            expect((await send(buildApp('inspector'), 'POST', '', {})).status).toBe(400);
            expect((await send(buildApp('inspector'), 'POST', '/wizard', {})).status).toBe(400);
        });

        it('copying an inspection is refused; an inspector reaches the handler', async () => {
            expect((await send(buildApp('staff'), 'POST', `/${INSP_ID}/clone`)).status).toBe(403);
            expect((await send(buildApp('inspector'), 'POST', `/${INSP_ID}/clone`)).status).toBe(404);
        });

        it('deleting an inspection is refused even when an override grants deleteInspection and scheduleOthers', async () => {
            const res = await send(buildApp('staff', { deleteInspection: true, scheduleOthers: true }), 'DELETE', `/${INSP_ID}`);
            expect(res.status).toBe(403);
            expect(await readRow()).toBeTruthy();
        });

        it('bulk: staff may reassign but not change status', async () => {
            const app = buildApp('staff');
            expect((await send(app, 'PATCH', '/bulk', { ids: [INSP_ID], action: 'updateStatus', status: INSPECTION_STATUS.COMPLETED })).status).toBe(403);
            expect((await send(app, 'PATCH', '/bulk', { ids: [INSP_ID], action: 'assignInspector', inspectorId: LEAD_B })).status).toBe(200);
            expect((await readRow())?.inspectorId).toBe(LEAD_B);
            expect((await readRow())?.status).toBe(INSPECTION_STATUS.SCHEDULED);
        });

        it('cancelling, restoring, completing and re-inspecting are refused to staff (a status or money change, or a new inspection)', async () => {
            const staff = buildApp('staff', { scheduleOthers: true });
            const cases: Array<[string, unknown]> = [
                ['cancel', { reason: 'client_request' }],
                ['uncancel', undefined],
                ['complete', undefined],
                ['reinspect', { selectedItemIds: ['x'] }],
            ];
            for (const [action, body] of cases) {
                expect((await send(staff, 'POST', `/${INSP_ID}/${action}`, body)).status, action).toBe(403);
            }
            expect((await readRow())?.status).toBe(INSPECTION_STATUS.SCHEDULED);
        });

        it('control: an inspector is not refused on those four (they reach validation or the handler)', async () => {
            const inspector = buildApp('inspector');
            for (const action of ['cancel', 'uncancel', 'complete', 'reinspect']) {
                expect((await send(inspector, 'POST', `/${INSP_ID}/${action}`, {})).status, action).not.toBe(403);
            }
        });

        it('bulk reassign is refused to staff when scheduleOthers is off', async () => {
            const res = await send(buildApp('staff', { scheduleOthers: false }), 'PATCH', '/bulk', { ids: [INSP_ID], action: 'assignInspector', inspectorId: LEAD_B });
            expect(res.status).toBe(403);
        });
    });
});
