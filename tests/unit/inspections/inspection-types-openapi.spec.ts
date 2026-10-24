/**
 * /api/admin/inspection-types is served by OpenAPI routes. The CRUD behaviour is covered by
 * inspection-types-api.spec.ts; this file pins what the conversion adds: the validation envelope on a bad body,
 * the role gate on every route, and the operations in the document.
 */
import { describe, it, expect, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import inspectionTypesRoutes from '../../../server/api/inspection-types';
import { AppError } from '../../../server/lib/errors';
import { buildOpenApiDocument } from '../../../server/lib/openapi/build-document';
import type { HonoConfig } from '../../../server/types/hono';

function buildApp(inspectionType: Record<string, unknown>, role = 'owner') {
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('userRole', role as never);
        c.set('tenantId', 't1');
        c.set('services', { inspectionType } as unknown as HonoConfig['Variables']['services']);
        await next();
    });
    app.onError((err, c) => {
        if (err instanceof AppError) return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status);
        throw err;
    });
    app.route('/api/admin', inspectionTypesRoutes);
    return app;
}

const post = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const put = (body: unknown) => ({ method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('inspection-types OpenAPI routes', () => {
    describe('validation', () => {
        it('POST with an empty name answers the validation envelope and writes nothing', async () => {
            const createInspectionType = vi.fn();
            const res = await buildApp({ createInspectionType }).request('/api/admin/inspection-types', post({ name: '' }));
            expect(res.status).toBe(400);
            const body = await res.json() as { success: boolean; error: { code: string; fields: Record<string, string> } };
            expect(body.success).toBe(false);
            expect(body.error.code).toBe('VALIDATION_ERROR');
            expect(Object.keys(body.error.fields)).toEqual(['name']);
            expect(createInspectionType).not.toHaveBeenCalled();
        });

        it('POST with a missing name is refused as well', async () => {
            const createInspectionType = vi.fn();
            const res = await buildApp({ createInspectionType }).request('/api/admin/inspection-types', post({ sortOrder: 2 }));
            expect(res.status).toBe(400);
            expect(createInspectionType).not.toHaveBeenCalled();
        });

        it('PUT with a wrong field type is refused before the service is called', async () => {
            const updateInspectionType = vi.fn();
            const res = await buildApp({ updateInspectionType }).request('/api/admin/inspection-types/it1', put({ enabled: 'yes' }));
            expect(res.status).toBe(400);
            expect(updateInspectionType).not.toHaveBeenCalled();
        });

        it('POST fills the default sort order and passes the parsed body to the service', async () => {
            const createInspectionType = vi.fn().mockResolvedValue({ id: 'new', tenantId: 't1', name: 'Clinic' });
            const res = await buildApp({ createInspectionType }).request('/api/admin/inspection-types', post({ name: 'Clinic' }));
            expect(res.status).toBe(201);
            expect(createInspectionType).toHaveBeenCalledWith('t1', { name: 'Clinic', sortOrder: 0 });
        });

        it('PUT passes only the fields that were sent (a partial update does not reset the sort order)', async () => {
            const updateInspectionType = vi.fn().mockResolvedValue(undefined);
            const res = await buildApp({ updateInspectionType }).request('/api/admin/inspection-types/it1', put({ name: 'Renamed' }));
            expect(res.status).toBe(200);
            expect(updateInspectionType).toHaveBeenCalledWith('t1', 'it1', { name: 'Renamed' });
        });
    });

    describe('role gate', () => {
        it('GET is open to owner, manager and inspector and closed to an agent', async () => {
            for (const role of ['owner', 'manager', 'inspector']) {
                const listInspectionTypes = vi.fn().mockResolvedValue([]);
                expect((await buildApp({ listInspectionTypes }, role).request('/api/admin/inspection-types')).status).toBe(200);
            }
            const listInspectionTypes = vi.fn();
            expect((await buildApp({ listInspectionTypes }, 'agent').request('/api/admin/inspection-types')).status).toBe(403);
            expect(listInspectionTypes).not.toHaveBeenCalled();
        });

        it('PUT and DELETE are refused for an inspector and never reach the service', async () => {
            const updateInspectionType = vi.fn();
            const deleteInspectionType = vi.fn();
            const app = buildApp({ updateInspectionType, deleteInspectionType }, 'inspector');
            expect((await app.request('/api/admin/inspection-types/it1', put({ name: 'X' }))).status).toBe(403);
            expect((await app.request('/api/admin/inspection-types/it1', { method: 'DELETE' })).status).toBe(403);
            expect(updateInspectionType).not.toHaveBeenCalled();
            expect(deleteInspectionType).not.toHaveBeenCalled();
        });

        it('a manager may write', async () => {
            const createInspectionType = vi.fn().mockResolvedValue({ id: 'm', tenantId: 't1', name: 'M' });
            expect((await buildApp({ createInspectionType }, 'manager').request('/api/admin/inspection-types', post({ name: 'M' }))).status).toBe(201);
        });
    });

    it('lists the four operations: reads as read scope, writes as admin scope, all extended', () => {
        const doc = buildOpenApiDocument(buildApp({}), { openapi: '3.0.0', info: { version: 'test', title: 't' } });
        const item = doc.paths?.['/api/admin/inspection-types'] as Record<string, Record<string, unknown>> | undefined;
        const one = doc.paths?.['/api/admin/inspection-types/{id}'] as Record<string, Record<string, unknown>> | undefined;
        expect(item?.get?.operationId).toBe('listInspectionTypes');
        expect(item?.post?.operationId).toBe('createInspectionType');
        expect(one?.put?.operationId).toBe('updateInspectionType');
        expect(one?.delete?.operationId).toBe('deleteInspectionType');
        expect(item?.get?.['x-scopes']).toEqual(['read']);
        for (const op of [item?.post, one?.put, one?.delete]) expect(op?.['x-scopes']).toEqual(['admin']);
        for (const op of [item?.get, item?.post, one?.put, one?.delete]) expect(op?.['x-tier']).toBe('extended');
    });
});
