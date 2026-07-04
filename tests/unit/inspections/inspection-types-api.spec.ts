import { describe, it, expect, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import inspectionTypesRoutes from '../../../server/api/inspection-types';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';

/**
 * Settings + Library IA — /api/admin/inspection-types CRUD over
 * InspectionTypeService. Mirrors admin-event-types.spec.ts: the service is
 * mocked, role/tenant are injected by middleware, and AppError throws are
 * serialized by an onError handler exactly as the app entry does.
 */
describe('admin inspection-types CRUD', () => {
    const row = { id: 'it1', tenantId: 't1', name: 'Medical Office', basedOn: 'office', description: null, enabled: true, sortOrder: 1, createdAt: new Date() };

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

    it('GET lists the tenant inspection types', async () => {
        const listInspectionTypes = vi.fn().mockResolvedValue([row]);
        const res = await buildApp({ listInspectionTypes }).request('/api/admin/inspection-types');
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { name: string }[] };
        expect(body.data[0].name).toBe('Medical Office');
        expect(listInspectionTypes).toHaveBeenCalledWith('t1');
    });

    it('GET is allowed for inspector role', async () => {
        const listInspectionTypes = vi.fn().mockResolvedValue([]);
        const res = await buildApp({ listInspectionTypes }, 'inspector').request('/api/admin/inspection-types');
        expect(res.status).toBe(200);
    });

    it('POST creates and returns the row (201)', async () => {
        const createInspectionType = vi.fn().mockResolvedValue(row);
        const res = await buildApp({ createInspectionType }).request('/api/admin/inspection-types', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'Medical Office', basedOn: 'office', sortOrder: 1 }),
        });
        expect(res.status).toBe(201);
        const body = await res.json() as { data: { id: string } };
        expect(body.data.id).toBe('it1');
        expect(createInspectionType).toHaveBeenCalledWith('t1', expect.objectContaining({ name: 'Medical Office' }));
    });

    it('POST rejects empty name (400)', async () => {
        const createInspectionType = vi.fn();
        const res = await buildApp({ createInspectionType }).request('/api/admin/inspection-types', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: '' }),
        });
        expect(res.status).toBe(400);
        expect(createInspectionType).not.toHaveBeenCalled();
    });

    it('PUT updates the row', async () => {
        const updateInspectionType = vi.fn().mockResolvedValue(undefined);
        const res = await buildApp({ updateInspectionType }).request('/api/admin/inspection-types/it1', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'Clinic' }),
        });
        expect(res.status).toBe(200);
        expect(updateInspectionType).toHaveBeenCalledWith('t1', 'it1', expect.objectContaining({ name: 'Clinic' }));
    });

    it('DELETE removes the row', async () => {
        const deleteInspectionType = vi.fn().mockResolvedValue(undefined);
        const res = await buildApp({ deleteInspectionType }).request('/api/admin/inspection-types/it1', { method: 'DELETE' });
        expect(res.status).toBe(200);
        expect(deleteInspectionType).toHaveBeenCalledWith('t1', 'it1');
    });

    it('POST is forbidden for inspector role (403)', async () => {
        const createInspectionType = vi.fn();
        const res = await buildApp({ createInspectionType }, 'inspector').request('/api/admin/inspection-types', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'X' }),
        });
        expect(res.status).toBe(403);
        expect(createInspectionType).not.toHaveBeenCalled();
    });
});
