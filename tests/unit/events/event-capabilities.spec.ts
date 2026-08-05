import { describe, it, expect, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { HonoConfig } from '../../../server/types/hono';
import type { Role } from '../../../server/lib/auth/roles';
import { AppError, ErrorCode } from '../../../server/lib/errors';

/**
 * Who may do what to a visit — asserted as HTTP status codes from real
 * requests, not as a service call.
 *
 * A capability checked inside a service function proves the FUNCTION checks it;
 * it says nothing about whether the route mounts the check. This repo has
 * already shipped a capability (`viewCommunication`) that was declared,
 * defaulted per role, returned by `/me`, documented, unit-asserted — and
 * enforced nowhere. Likewise `createRoutesStub` does not run middleware, so an
 * authorization test built on a rendered component is a false green: it proves
 * the button is hidden, not that the API refuses the request somebody types by
 * hand.
 *
 * So: build the router the way `server/index.ts` mounts it, send a real
 * request, and read the status code off the response.
 *
 *   | action                | who                 |
 *   |-----------------------|---------------------|
 *   | mark a visit complete | inspector — required|
 *   | mark results_received | owner/manager       |
 *   | delete a visit        | owner/manager       |
 *   | delete a report       | owner/manager       |
 */

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn(() => ({})) }));
const deleteReport = vi.fn(async () => undefined);
vi.mock('../../../server/lib/inspection/reports', () => ({ deleteReport: (...a: unknown[]) => deleteReport(...(a as [])) }));

// Imported AFTER the mocks above are registered.
/* eslint-disable import/first */
import eventsRoutes from '../../../server/api/events';
import inspectionReportRoutes from '../../../server/api/inspections/reports';
/* eslint-enable import/first */

const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_ID   = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const EVENT_ID  = 'evt_1';
const FAKE_ENV = { DB: {} } as HonoConfig['Bindings'];

/**
 * The API app as the worker assembles it: the same routers, the same mount
 * paths (`server/index.ts` routes eventsRoutes at `/api`; inspectionReportRoutes
 * is folded into `/api/inspections`), and the same AppError → status mapping the
 * global handler performs. Only the auth middleware is replaced, by the one
 * thing a test must be able to vary: which role is calling.
 */
function buildApp(role: Role, event: Record<string, unknown> = {}) {
    const app = new OpenAPIHono<HonoConfig>();
    app.onError((err: unknown, c: Context<HonoConfig>) => {
        if (err instanceof AppError) {
            return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status as 500);
        }
        return c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500);
    });
    app.use('*', async (c, next) => {
        c.set('tenantId', TENANT_ID);
        c.set('user', { sub: USER_ID, role, tenantId: TENANT_ID });
        c.set('userRole', role);
        c.set('services', { event } as unknown as HonoConfig['Variables']['services']);
        await next();
    });
    app.route('/api', eventsRoutes);
    app.route('/api/inspections', inspectionReportRoutes);
    return app;
}

const putStatus = (role: Role, status: string, event: Record<string, unknown> = {}) =>
    buildApp(role, event).request(`/api/events/${EVENT_ID}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status }),
    }, FAKE_ENV);

describe('PUT /api/events/:id — marking a visit complete', () => {
    it('lets an inspector complete a visit (200)', async () => {
        const updateEventStatus = vi.fn().mockResolvedValue(undefined);
        const res = await putStatus('inspector', 'completed', { updateEventStatus });
        expect(res.status).toBe(200);
        expect(updateEventStatus).toHaveBeenCalledWith(TENANT_ID, EVENT_ID, 'completed');
    });

    it('lets an inspector cancel a visit they are standing at (200)', async () => {
        const updateEventStatus = vi.fn().mockResolvedValue(undefined);
        const res = await putStatus('inspector', 'cancelled', { updateEventStatus });
        expect(res.status).toBe(200);
    });

    it('refuses an unknown status with 400 before any role question', async () => {
        const updateEventStatus = vi.fn();
        const res = await putStatus('inspector', 'results-received', { updateEventStatus });
        expect(res.status).toBe(400);
        expect(updateEventStatus).not.toHaveBeenCalled();
    });
});

describe('PUT /api/events/:id — marking results_received', () => {
    it('rejects results_received from an inspector with 403', async () => {
        const updateEventStatus = vi.fn();
        const res = await putStatus('inspector', 'results_received', { updateEventStatus });
        expect(res.status).toBe(403);
        const body = await res.json() as { error: { code: string } };
        expect(body.error.code).toBe(ErrorCode.FORBIDDEN);
        // The refusal must happen before the write, not after it.
        expect(updateEventStatus).not.toHaveBeenCalled();
    });

    it('allows results_received from a manager (200)', async () => {
        const updateEventStatus = vi.fn().mockResolvedValue(undefined);
        const res = await putStatus('manager', 'results_received', { updateEventStatus });
        expect(res.status).toBe(200);
        expect(updateEventStatus).toHaveBeenCalledWith(TENANT_ID, EVENT_ID, 'results_received');
    });

    it('allows results_received from an owner (200)', async () => {
        const updateEventStatus = vi.fn().mockResolvedValue(undefined);
        const res = await putStatus('owner', 'results_received', { updateEventStatus });
        expect(res.status).toBe(200);
    });
});

describe('DELETE /api/events/:id — removing a visit', () => {
    it('rejects an inspector with 403', async () => {
        const deleteEvent = vi.fn();
        const res = await buildApp('inspector', { deleteEvent })
            .request(`/api/events/${EVENT_ID}`, { method: 'DELETE' }, FAKE_ENV);
        expect(res.status).toBe(403);
        expect(deleteEvent).not.toHaveBeenCalled();
    });

    it('allows a manager (200)', async () => {
        const deleteEvent = vi.fn().mockResolvedValue(undefined);
        const res = await buildApp('manager', { deleteEvent })
            .request(`/api/events/${EVENT_ID}`, { method: 'DELETE' }, FAKE_ENV);
        expect(res.status).toBe(200);
        expect(deleteEvent).toHaveBeenCalledWith(TENANT_ID, EVENT_ID);
    });
});

describe('DELETE /api/inspections/:id/reports/:reportId — destroying a deliverable', () => {
    it('rejects an inspector with 403 and never reaches the delete', async () => {
        deleteReport.mockClear();
        const res = await buildApp('inspector')
            .request('/api/inspections/insp_1/reports/rep_1', { method: 'DELETE' }, FAKE_ENV);
        expect(res.status).toBe(403);
        expect(deleteReport).not.toHaveBeenCalled();
    });

    it('lets a manager through to the delete (200)', async () => {
        deleteReport.mockClear();
        const res = await buildApp('manager')
            .request('/api/inspections/insp_1/reports/rep_1', { method: 'DELETE' }, FAKE_ENV);
        expect(res.status).toBe(200);
        expect(deleteReport).toHaveBeenCalledTimes(1);
    });
});
