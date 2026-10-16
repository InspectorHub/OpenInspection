/**
 * Three inspector-side writes had no role guard of their own: the on-site client signature
 * (`POST /api/inspections/:id/sign`) and the inspector document upload and delete
 * (`PUT /:id/documents`, `DELETE /:id/documents/:docId`). They relied on the global layers
 * and answered to any signed-in user. Now each names `requireRole('owner', 'manager',
 * 'inspector')`, which office staff pass through the inspector tier.
 *
 * Real routers; the handlers are stubbed to a marker so "reached the handler" is observable.
 * Each refusal is paired with the roles that get through.
 */
import { describe, it, expect } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { AppError } from '../../../server/lib/errors';
import { inspectorDocumentsRoutes } from '../../../server/api/client-documents';
import agreementSignRoutes from '../../../server/api/inspections/agreement-sign';
import type { HonoConfig } from '../../../server/types/hono';

function appFor(role: string | undefined) {
    const app = new OpenAPIHono<HonoConfig>();
    app.onError((err, c) => (err instanceof AppError
        ? c.json({ success: false, error: { code: err.code, message: err.message } }, err.status)
        : c.json({ success: false, error: { code: 'reached_handler', message: String(err) } }, 500)));
    app.use('*', async (c, next) => {
        c.set('tenantId', 'tenant-1');
        c.set('user', { sub: 'user-1', role, tenantId: 'tenant-1' } as never);
        if (role) c.set('userRole', role as never);
        // No services on purpose: a request that gets past the guard fails inside the handler (500), not with 401/403.
        await next();
    });
    app.route('/api/inspections', inspectorDocumentsRoutes);
    app.route('/api/inspections', agreementSignRoutes);
    return app;
}

const WRITES: Array<[string, string, string]> = [
    ['client signature', 'POST', '/api/inspections/i1/sign'],
    ['document upload', 'PUT', '/api/inspections/i1/documents?filename=a.pdf&category=other'],
    ['document delete', 'DELETE', '/api/inspections/i1/documents/d1'],
];

const call = (role: string | undefined, method: string, path: string) =>
    appFor(role).request(path, { method, headers: { 'content-type': 'application/json' }, ...(method === 'POST' ? { body: '{}' } : {}) });

describe.each(WRITES)('%s', (_name, method, path) => {
    it('is refused to an agent and to a request with no role', async () => {
        expect((await call('agent', method, path)).status).toBe(403);
        expect((await call(undefined, method, path)).status).toBe(401);
    });

    it.each(['owner', 'manager', 'inspector', 'staff'])('POSITIVE CONTROL - %s gets past the guard', async (role) => {
        const status = (await call(role, method, path)).status;
        expect([401, 403], `${role} was refused with ${status}`).not.toContain(status);
    });
});
