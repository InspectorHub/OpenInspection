/**
 * The two event creates and the status change are OpenAPI routes that still read and validate their own body. Money
 * redaction and the money-write guard are covered over the real service by event-money.spec.ts; this file pins what
 * the conversion must not change: the order of the checks, the handler own 400 (field errors, not the validation
 * envelope), the success bodies, and that the operations are described without a request body and kept out of MCP.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import eventsRoutes from '../../../server/api/events';
import { AppError, Errors } from '../../../server/lib/errors';
import { buildOpenApiDocument } from '../../../server/lib/openapi/build-document';
import type { HonoConfig } from '../../../server/types/hono';

const visibility = vi.hoisted(() => ({
    resolveInspectionScope: vi.fn(),
    requireVisibleEvent: vi.fn(),
}));
vi.mock('../../../server/lib/inspection/visibility', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../server/lib/inspection/visibility')>();
    return { ...actual, ...visibility };
});

// No money-named fields in the stored rows, so the response projection has nothing to redact and needs no lookup.
const TYPE_ROW = { id: 'et9', tenantId: 't1', name: 'Radon', slug: 'radon', defaultDurationMin: 30, color: '#6366f1', sortOrder: 0, active: true };
const EVENT_ROW = { id: 'ev9', tenantId: 't1', inspectionId: 'i9', eventTypeId: 'et1', durationMin: 60, status: 'scheduled' };

function buildApp(event: Record<string, unknown>, role = 'owner') {
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('userRole', role as never);
        c.set('tenantId', 't1');
        c.set('services', { event } as unknown as HonoConfig['Variables']['services']);
        await next();
    });
    app.onError((err, c) => {
        if (err instanceof AppError) return c.json({ success: false, error: { code: err.code, message: err.message, details: err.details } }, err.status);
        throw err;
    });
    app.route('/api', eventsRoutes);
    return app;
}

const ENV = { DB: {} } as HonoConfig['Bindings'];
const send = (method: string, body: unknown) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => {
    visibility.resolveInspectionScope.mockReset().mockResolvedValue({ kind: 'all' });
    visibility.requireVisibleEvent.mockReset().mockResolvedValue(undefined);
});

describe('POST /api/event-types', () => {
    it('creates with the handler defaults applied after the raw body was checked, and answers 201', async () => {
        const createEventType = vi.fn().mockResolvedValue(TYPE_ROW);
        const res = await buildApp({ createEventType }).request('/api/event-types', send('POST', { name: 'Radon', slug: 'radon' }));
        expect(res.status).toBe(201);
        expect(await res.json()).toEqual({ success: true, data: TYPE_ROW });
        expect(createEventType).toHaveBeenCalledWith('t1', {
            name: 'Radon', slug: 'radon', defaultDurationMin: 30, defaultPriceCents: 0, color: '#6366f1', sortOrder: 0,
        });
    });

    it('answers its own 400 with the field errors, not the validation envelope, and never reaches the service', async () => {
        const createEventType = vi.fn();
        const res = await buildApp({ createEventType }).request('/api/event-types', send('POST', { name: '', slug: 'Bad Slug' }));
        expect(res.status).toBe(400);
        const body = await res.json() as { error: { code: string; message: string; details: Record<string, string[]> } };
        expect(body.error.code).not.toBe('VALIDATION_ERROR');
        expect(body.error.message).toBe('Invalid event type');
        expect(Object.keys(body.error.details).sort()).toEqual(['name', 'slug']);
        expect(createEventType).not.toHaveBeenCalled();
    });

    it('is refused for an inspector before the body is read (positive control: a manager gets through)', async () => {
        const createEventType = vi.fn().mockResolvedValue(TYPE_ROW);
        const refused = await buildApp({ createEventType }, 'inspector').request('/api/event-types', send('POST', { name: '' }));
        expect(refused.status).toBe(403);
        expect(createEventType).not.toHaveBeenCalled();
        const ok = await buildApp({ createEventType }, 'manager').request('/api/event-types', send('POST', { name: 'Radon', slug: 'radon' }));
        expect(ok.status).toBe(201);
    });
});

describe('POST /api/inspections/{inspectionId}/events', () => {
    const body = { eventTypeId: 'et1', scheduledAt: '2099-01-02T10:00:00.000Z', durationMin: 60 };

    it('creates the visit for the inspection named in the path, with the date parsed, and answers 201', async () => {
        const createEvent = vi.fn().mockResolvedValue(EVENT_ROW);
        const res = await buildApp({ createEvent }, 'inspector').request('/api/inspections/i9/events', send('POST', body));
        expect(res.status).toBe(201);
        expect(await res.json()).toEqual({ success: true, data: EVENT_ROW });
        expect(createEvent).toHaveBeenCalledWith('t1', 'i9', { ...body, priceCents: 0, scheduledAt: new Date(body.scheduledAt) });
    });

    it('answers its own 400 with the field errors for a body that is not a visit', async () => {
        const createEvent = vi.fn();
        const res = await buildApp({ createEvent }).request('/api/inspections/i9/events', send('POST', { eventTypeId: '', scheduledAt: 'tomorrow', durationMin: 0 }));
        expect(res.status).toBe(400);
        const out = await res.json() as { error: { code: string; message: string; details: Record<string, string[]> } };
        expect(out.error.code).not.toBe('VALIDATION_ERROR');
        expect(out.error.message).toBe('Invalid event');
        expect(Object.keys(out.error.details).sort()).toEqual(['durationMin', 'eventTypeId', 'scheduledAt']);
        expect(createEvent).not.toHaveBeenCalled();
    });

    it('is refused for an agent (positive control: owner, manager and inspector all get through)', async () => {
        const createEvent = vi.fn().mockResolvedValue(EVENT_ROW);
        expect((await buildApp({ createEvent }, 'agent').request('/api/inspections/i9/events', send('POST', body))).status).toBe(403);
        expect(createEvent).not.toHaveBeenCalled();
        for (const role of ['owner', 'manager', 'inspector']) {
            expect((await buildApp({ createEvent }, role).request('/api/inspections/i9/events', send('POST', body))).status).toBe(201);
        }
    });
});

describe('PUT /api/events/{id}', () => {
    it('changes the status for an owner, after the visibility check, and answers { success: true }', async () => {
        const updateEventStatus = vi.fn().mockResolvedValue(undefined);
        const res = await buildApp({ updateEventStatus }).request('/api/events/ev1', send('PUT', { status: 'completed' }), ENV);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ success: true });
        expect(visibility.requireVisibleEvent).toHaveBeenCalledTimes(1);
        expect(updateEventStatus).toHaveBeenCalledWith('t1', 'ev1', 'completed');
    });

    it('answers its own 400 with the field errors, before the role-dependent checks (a staff caller with a bad body sees the 400)', async () => {
        const updateEventStatus = vi.fn();
        const res = await buildApp({ updateEventStatus }, 'staff').request('/api/events/ev1', send('PUT', { status: 'nonsense' }), ENV);
        expect(res.status).toBe(400);
        const body = await res.json() as { error: { code: string; message: string; details: Record<string, string[]> } };
        expect(body.error.code).not.toBe('VALIDATION_ERROR');
        expect(body.error.message).toBe('Invalid status');
        expect(Object.keys(body.error.details)).toEqual(['status']);
        expect(updateEventStatus).not.toHaveBeenCalled();
    });

    it('refuses office staff for any status before the visit is looked up (positive control: an inspector completes the same visit)', async () => {
        const updateEventStatus = vi.fn().mockResolvedValue(undefined);
        const staff = await buildApp({ updateEventStatus }, 'staff').request('/api/events/ev1', send('PUT', { status: 'completed' }), ENV);
        expect(staff.status).toBe(403);
        expect(visibility.requireVisibleEvent).not.toHaveBeenCalled();
        expect(updateEventStatus).not.toHaveBeenCalled();
        const inspector = await buildApp({ updateEventStatus }, 'inspector').request('/api/events/ev1', send('PUT', { status: 'completed' }), ENV);
        expect(inspector.status).toBe(200);
        expect(updateEventStatus).toHaveBeenCalledWith('t1', 'ev1', 'completed');
    });

    it('keeps results_received for owner and manager, refusing an inspector before the visit is looked up', async () => {
        const updateEventStatus = vi.fn().mockResolvedValue(undefined);
        const refused = await buildApp({ updateEventStatus }, 'inspector').request('/api/events/ev1', send('PUT', { status: 'results_received' }), ENV);
        expect(refused.status).toBe(403);
        expect(visibility.requireVisibleEvent).not.toHaveBeenCalled();
        expect(updateEventStatus).not.toHaveBeenCalled();
        for (const role of ['owner', 'manager']) {
            const ok = await buildApp({ updateEventStatus }, role).request('/api/events/ev1', send('PUT', { status: 'results_received' }), ENV);
            expect(ok.status).toBe(200);
        }
        expect(updateEventStatus).toHaveBeenCalledTimes(2);
    });

    it('answers 404 and changes nothing when the visit is not one the caller can see', async () => {
        visibility.requireVisibleEvent.mockRejectedValue(Errors.NotFound('Event not found'));
        const updateEventStatus = vi.fn();
        const res = await buildApp({ updateEventStatus }).request('/api/events/ev1', send('PUT', { status: 'cancelled' }), ENV);
        expect(res.status).toBe(404);
        expect(updateEventStatus).not.toHaveBeenCalled();
    });
});

describe('the three write operations in the OpenAPI document', () => {
    it('are described without a request body (the handlers read it) and kept out of MCP', () => {
        const doc = buildOpenApiDocument(buildApp({}), { openapi: '3.0.0', info: { version: 'test', title: 't' } });
        const paths = doc.paths as Record<string, Record<string, Record<string, unknown>>>;
        const ops = [
            [paths['/api/event-types']?.post, 'createVisitEventType'],
            [paths['/api/inspections/{inspectionId}/events']?.post, 'createInspectionEvent'],
            [paths['/api/events/{id}']?.put, 'updateInspectionEventStatus'],
        ] as const;
        for (const [op, operationId] of ops) {
            expect(op?.operationId).toBe(operationId);
            expect(op?.['x-tier']).toBe('excluded');
            expect(op?.['x-scopes']).toEqual([]);
            expect(op?.requestBody).toBeUndefined();
            expect(String(op?.description)).toContain('JSON body is {');
        }
    });
});
