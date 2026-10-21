/**
 * The two event reads and the event delete are OpenAPI routes of the events router, and so are the two creates and
 * the status change, which still read and validate their own body (events-write-openapi-routes.spec.ts). Money
 * redaction and the money-write guard are covered by event-money.spec.ts; this file pins the role gates of the reads
 * and the delete, their bodies, and that the handlers that parse their own body kept answering their own 400.
 */
import { describe, it, expect, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import eventsRoutes from '../../../server/api/events';
import { AppError } from '../../../server/lib/errors';
import { buildOpenApiDocument } from '../../../server/lib/openapi/build-document';
import type { HonoConfig } from '../../../server/types/hono';

// No money-named fields, so the response projection has nothing to redact and needs no capability lookup.
const TYPE_ROW = { id: 'et1', tenantId: 't1', name: 'Radon', slug: 'radon', defaultDurationMin: 60, color: '#123456', sortOrder: 1, active: true };

function buildApp(event: Record<string, unknown>, role = 'owner') {
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('userRole', role as never);
        c.set('tenantId', 't1');
        c.set('services', { event } as unknown as HonoConfig['Variables']['services']);
        await next();
    });
    app.onError((err, c) => {
        if (err instanceof AppError) return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status);
        throw err;
    });
    app.route('/api', eventsRoutes);
    return app;
}

describe('events OpenAPI routes', () => {
    describe('GET /api/event-types', () => {
        it('lists the tenant event types for owner, manager and inspector', async () => {
            for (const role of ['owner', 'manager', 'inspector']) {
                const listEventTypes = vi.fn().mockResolvedValue([TYPE_ROW]);
                const res = await buildApp({ listEventTypes }, role).request('/api/event-types');
                expect(res.status).toBe(200);
                expect(await res.json()).toEqual({ success: true, data: [TYPE_ROW] });
                expect(listEventTypes).toHaveBeenCalledWith('t1');
            }
        });

        it('is refused for an agent and never reaches the service', async () => {
            const listEventTypes = vi.fn();
            const res = await buildApp({ listEventTypes }, 'agent').request('/api/event-types');
            expect(res.status).toBe(403);
            expect(listEventTypes).not.toHaveBeenCalled();
        });
    });

    describe('GET /api/inspections/{inspectionId}/events', () => {
        it('lists the visits of the named inspection for the tenant', async () => {
            const listInspectionEvents = vi.fn().mockResolvedValue([{ id: 'ev1', inspectionId: 'i9', status: 'scheduled' }]);
            const res = await buildApp({ listInspectionEvents }, 'inspector').request('/api/inspections/i9/events');
            expect(res.status).toBe(200);
            expect(await res.json()).toEqual({ success: true, data: [{ id: 'ev1', inspectionId: 'i9', status: 'scheduled' }] });
            expect(listInspectionEvents).toHaveBeenCalledWith('t1', 'i9');
        });

        it('is refused for an agent', async () => {
            const listInspectionEvents = vi.fn();
            const res = await buildApp({ listInspectionEvents }, 'agent').request('/api/inspections/i9/events');
            expect(res.status).toBe(403);
            expect(listInspectionEvents).not.toHaveBeenCalled();
        });
    });

    describe('DELETE /api/events/{id}', () => {
        it('deletes for an owner or a manager', async () => {
            for (const role of ['owner', 'manager']) {
                const deleteEvent = vi.fn().mockResolvedValue(undefined);
                const res = await buildApp({ deleteEvent }, role).request('/api/events/ev1', { method: 'DELETE' });
                expect(res.status).toBe(200);
                expect(await res.json()).toEqual({ success: true });
                expect(deleteEvent).toHaveBeenCalledWith('t1', 'ev1');
            }
        });

        it('is refused for an inspector and never reaches the service', async () => {
            const deleteEvent = vi.fn();
            const res = await buildApp({ deleteEvent }, 'inspector').request('/api/events/ev1', { method: 'DELETE' });
            expect(res.status).toBe(403);
            expect(deleteEvent).not.toHaveBeenCalled();
        });
    });

    describe('the handlers that parse their own body', () => {
        it('POST /api/event-types still validates its own body and answers its own 400', async () => {
            const createEventType = vi.fn();
            const res = await buildApp({ createEventType }).request('/api/event-types', {
                method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '' }),
            });
            expect(res.status).toBe(400);
            const body = await res.json() as { error: { code: string } };
            expect(body.error.code).not.toBe('VALIDATION_ERROR');
            expect(createEventType).not.toHaveBeenCalled();
        });

        it('PUT /api/events/{id} still refuses a status that is not in the enum', async () => {
            const updateEventStatus = vi.fn();
            const res = await buildApp({ updateEventStatus }, 'inspector').request('/api/events/ev1', {
                method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'nonsense' }),
            });
            expect(res.status).toBe(400);
            expect(updateEventStatus).not.toHaveBeenCalled();
        });
    });

    it('lists the three read-side operations as extended tier, reads read scope and the delete write scope', () => {
        const doc = buildOpenApiDocument(buildApp({}), { openapi: '3.0.0', info: { version: 'test', title: 't' } });
        const paths = doc.paths as Record<string, Record<string, Record<string, unknown>>>;
        const types = paths['/api/event-types']?.get;
        const events = paths['/api/inspections/{inspectionId}/events']?.get;
        const del = paths['/api/events/{id}']?.delete;
        expect([types?.operationId, events?.operationId, del?.operationId]).toEqual(['listVisitEventTypes', 'listInspectionEvents', 'deleteInspectionEvent']);
        expect([types?.['x-scopes'], events?.['x-scopes'], del?.['x-scopes']]).toEqual([['read'], ['read'], ['write']]);
        for (const op of [types, events, del]) expect(op?.['x-tier']).toBe('extended');
    });
});
