import { describe, it, expect, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import agentRoutes from '../../../server/api/agent';
import type { HonoConfig } from '../../../server/types/hono';

/**
 * Defect photos on the agent repair-items page need an agent-authenticated way
 * to read an R2 object: the staff photo route is owner/manager/inspector-only
 * and the public one wants a portal token, so an agent session satisfies
 * neither. This route is that path — and it must be no wider than the agent's
 * existing referral access:
 *
 *   1. no association with the inspection  -> 404 (never the bytes)
 *   2. a key outside `${tenantId}/inspections/${id}/` -> 404, even when the
 *      agent legitimately has access to THAT inspection (no key smuggling)
 *   3. associated + in-scope key           -> the object
 */
describe('GET /api/agent/inspections/:id/photo', () => {
    const KEY = 't1/inspections/i1/photos/p1.jpg';

    function app(accessToInspection: unknown, bucketGet = vi.fn()) {
        const a = new OpenAPIHono<HonoConfig>();
        a.use('*', async (c, next) => {
            c.set('userRole', 'agent');
            c.set('user', { sub: 'u1' } as never);
            c.set('services', { agent: { accessToInspection } } as never);
            await next();
        });
        a.route('/api/agent', agentRoutes);
        return { app: a, bucketGet };
    }

    const env = (bucketGet: unknown) => ({ PHOTOS: { get: bucketGet } }) as never;

    function url(key: string, id = 'i1') {
        return `/api/agent/inspections/${id}/photo?key=${encodeURIComponent(key)}`;
    }

    it('404s when the agent has no association with the inspection', async () => {
        const accessToInspection = vi.fn().mockResolvedValue(null);
        const bucketGet = vi.fn();
        const { app: a } = app(accessToInspection, bucketGet);
        const res = await a.request(url(KEY), {}, env(bucketGet));
        expect(res.status).toBe(404);
        // The bucket is never touched for an unauthorized caller.
        expect(bucketGet).not.toHaveBeenCalled();
    });

    it('404s a key belonging to another tenant or another inspection', async () => {
        const accessToInspection = vi.fn().mockResolvedValue({ tenantId: 't1' });
        const bucketGet = vi.fn();
        const { app: a } = app(accessToInspection, bucketGet);

        const otherTenant = await a.request(url('t2/inspections/i1/photos/p1.jpg'), {}, env(bucketGet));
        expect(otherTenant.status).toBe(404);

        const otherInspection = await a.request(url('t1/inspections/i9/photos/p1.jpg'), {}, env(bucketGet));
        expect(otherInspection.status).toBe(404);

        expect(bucketGet).not.toHaveBeenCalled();
    });

    it('streams the object for an associated agent and an in-scope key', async () => {
        const accessToInspection = vi.fn().mockResolvedValue({ tenantId: 't1' });
        const bucketGet = vi.fn().mockResolvedValue({
            body: new ReadableStream(),
            httpMetadata: { contentType: 'image/jpeg' },
            customMetadata: { originalName: 'roof.jpg' },
            httpEtag: '"abc"',
        });
        const { app: a } = app(accessToInspection, bucketGet);

        const res = await a.request(url(KEY), {}, env(bucketGet));
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toBe('image/jpeg');
        expect(bucketGet).toHaveBeenCalledWith(KEY);
        expect(accessToInspection).toHaveBeenCalledWith('u1', 'i1');
    });

    it('404s when the object is missing from the bucket', async () => {
        const accessToInspection = vi.fn().mockResolvedValue({ tenantId: 't1' });
        const bucketGet = vi.fn().mockResolvedValue(null);
        const { app: a } = app(accessToInspection, bucketGet);
        const res = await a.request(url(KEY), {}, env(bucketGet));
        expect(res.status).toBe(404);
    });
});
