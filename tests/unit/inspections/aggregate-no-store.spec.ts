import { describe, it, expect } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { registerInspectionScopeGuards } from '../../../server/lib/middleware/inspection-scope';
import { RESERVED_INSPECTION_SEGMENTS } from '../../../server/lib/inspection/reserved-segments';
import type { HonoConfig } from '../../../server/types/hono';

const ID = '3f2b8c1e-9a4d-4e6b-8c11-0a1b2c3d4e5f';

function buildApp() {
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('userRole', 'owner');
        c.set('user', { sub: 'u1', role: 'owner', tenantId: 't1' });
        c.set('tenantId', 't1');
        await next();
    });
    registerInspectionScopeGuards(app);
    for (const seg of RESERVED_INSPECTION_SEGMENTS) app.get(`/api/inspections/${seg}`, (c) => c.json({ seg }));
    app.get('/api/inspections', (c) => c.json({ list: true }));
    app.get('/api/inspections/:id', (c) => c.json({ id: c.req.param('id') }));
    app.get('/api/inspections/:id/results', (c) => c.json({ results: true }));
    app.get('/api/inspections/files/:key', (c) => c.body('x', 200, { 'Cache-Control': 'private, max-age=300' }));
    return app;
}

describe('aggregate inspection endpoints are never cacheable', () => {
    it.each(['/api/inspections', ...[...RESERVED_INSPECTION_SEGMENTS].map((s) => `/api/inspections/${s}`)])(
        '%s answers private, no-store',
        async (path) => {
            const res = await buildApp().request(path);
            expect(res.status).toBe(200);
            expect(res.headers.get('Cache-Control')).toBe('private, no-store');
        },
    );

    it('leaves a single inspection, its results and a route that set its own header alone', async () => {
        const app = buildApp();
        expect((await app.request(`/api/inspections/${ID}`)).headers.get('Cache-Control')).toBeNull();
        expect((await app.request(`/api/inspections/${ID}/results`)).headers.get('Cache-Control')).toBeNull();
        expect((await app.request('/api/inspections/files/abc')).headers.get('Cache-Control')).toBe('private, max-age=300');
    });
});
