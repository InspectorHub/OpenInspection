import { describe, it, expect, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import adminRoutes from '../../server/api/admin';
import type { HonoConfig } from '../../server/types/hono';

/**
 * C-10 ③-D — admin event-types CRUD over the existing EventService
 * (listEventTypes/createEventType/updateEventType/deactivateEventType). The
 * page already hits /api/admin/event-types[/:id]; these routes back them.
 */
describe('admin event-types CRUD — ③-D', () => {
    const row = { id: 'e1', name: 'Radon', slug: 'radon', defaultDurationMin: 30, defaultPriceCents: 9000, color: '#123', sortOrder: 1, active: true };

    function buildApp(event: Record<string, unknown>) {
        const app = new OpenAPIHono<HonoConfig>();
        app.use('*', async (c, next) => {
            c.set('userRole', 'owner');
            c.set('tenantId', 't1');
            c.set('services', { event } as unknown as HonoConfig['Variables']['services']);
            await next();
        });
        app.route('/api/admin', adminRoutes);
        return app;
    }

    it('GET /api/admin/event-types lists the tenant event types', async () => {
        const listEventTypes = vi.fn().mockResolvedValue([row]);
        const res = await buildApp({ listEventTypes }).request('/api/admin/event-types');
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { slug: string }[] };
        expect(body.data[0].slug).toBe('radon');
        expect(listEventTypes).toHaveBeenCalledWith('t1');
    });

    it('POST /api/admin/event-types creates and returns the row', async () => {
        const createEventType = vi.fn().mockResolvedValue(row);
        const res = await buildApp({ createEventType }).request('/api/admin/event-types', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'Radon', slug: 'radon', defaultDurationMin: 30, defaultPriceCents: 9000, color: '#123', sortOrder: 1 }),
        });
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { id: string } };
        expect(body.data.id).toBe('e1');
        expect(createEventType).toHaveBeenCalledWith('t1', expect.objectContaining({ slug: 'radon' }));
    });

    it('PATCH /api/admin/event-types/:id updates and returns the fresh row', async () => {
        const updateEventType = vi.fn().mockResolvedValue(undefined);
        const listEventTypes = vi.fn().mockResolvedValue([{ ...row, name: 'Radon Test' }]);
        const res = await buildApp({ updateEventType, listEventTypes }).request('/api/admin/event-types/e1', {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'Radon Test' }),
        });
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { name: string } };
        expect(body.data.name).toBe('Radon Test');
        expect(updateEventType).toHaveBeenCalledWith('t1', 'e1', expect.objectContaining({ name: 'Radon Test' }));
    });

    it('DELETE /api/admin/event-types/:id deactivates the row', async () => {
        const deactivateEventType = vi.fn().mockResolvedValue(undefined);
        const res = await buildApp({ deactivateEventType }).request('/api/admin/event-types/e1', { method: 'DELETE' });
        expect(res.status).toBe(200);
        expect(deactivateEventType).toHaveBeenCalledWith('t1', 'e1');
    });
});
