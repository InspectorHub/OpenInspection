import { describe, it, expect } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { registerInspectionScopeGuards } from '../../../server/lib/middleware/inspection-scope';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';

type Persona = 'anonymous' | 'agent' | 'inspector' | 'staff' | 'manager' | 'owner';

function buildApp(persona: Persona) {
    const app = new OpenAPIHono<HonoConfig>();
    app.onError((err, c) => err instanceof AppError
        ? c.json({ success: false, error: { code: err.code, message: err.message } }, err.status)
        : c.json({ success: false, error: { message: String(err) } }, 500));
    app.use('*', async (c, next) => {
        if (persona !== 'anonymous') {
            c.set('userRole', persona);
            c.set('user', { sub: 'u1', role: persona, tenantId: 't1' });
            c.set('tenantId', 't1');
        }
        await next();
    });
    registerInspectionScopeGuards(app);
    app.get('/api/inspections/:id/results', (c) => c.json({ reached: true }));
    app.get('/api/inspections/templates', (c) => c.json({ reached: true }));
    app.get('/api/inspections', (c) => c.json({ reached: true }));
    return app;
}

describe('inspection path guard (role gate)', () => {
    for (const path of ['/api/inspections/i1/results', '/api/inspections/templates']) {
        it(`${path}: anonymous is 401, agent is 403`, async () => {
            expect((await buildApp('anonymous').request(path)).status).toBe(401);
            expect((await buildApp('agent').request(path)).status).toBe(403);
        });
        it(`${path}: staff roles reach the handler (positive control)`, async () => {
            for (const p of ['inspector', 'staff', 'manager', 'owner'] as const) {
                const res = await buildApp(p).request(path);
                expect(res.status).toBe(200);
                expect(await res.json()).toEqual({ reached: true });
            }
        });
    }
    it('does not claim the collection route, which carries its own gate', async () => {
        expect((await buildApp('anonymous').request('/api/inspections')).status).toBe(200);
    });
});
