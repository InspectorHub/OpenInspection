/**
 * GET /api/inspections/inspectors — gated on `scheduleOthers`.
 *
 * The route lists every account's email and role for the assignee picker. It was
 * open to every inspector, while the writes the picker feeds (bulk reassign,
 * schedule) already require `scheduleOthers`. The gate is middleware, so this is
 * exercised over HTTP: a handler-level test would answer 200 for everybody.
 */
import { describe, it, expect } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import bulkRoutes from '../../../server/api/inspections/bulk';
import type { HonoConfig } from '../../../server/types/hono';
import type { UserRole } from '../../../server/types/auth';
import { AppError } from '../../../server/lib/errors';

const TENANT = '00000000-0000-0000-0000-000000000001';
const FAKE_ENV = { DB: {} } as unknown as HonoConfig['Bindings'];
const ROW = { id: 'u-1', email: 'colleague@a.test', role: 'manager', createdAt: new Date() };

function buildApp(role: UserRole, overrides: Record<string, boolean> | null = null) {
    const app = new OpenAPIHono<HonoConfig>();
    app.onError((err, c) => {
        if (err instanceof AppError) return c.json({ success: false, error: { code: err.code, message: err.message } }, err.status);
        return c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500);
    });
    app.use('*', async (c, next) => {
        c.set('tenantId', TENANT);
        c.set('userRole', role);
        c.set('user', { sub: 'actor', role, tenantId: TENANT });
        c.set('sdb', { getById: async () => ({ permissionOverrides: overrides }) } as unknown as HonoConfig['Variables']['sdb']);
        c.set('services', {
            admin: { getMembers: async () => ({ members: [ROW] }) },
        } as unknown as HonoConfig['Variables']['services']);
        await next();
    });
    app.route('/api/inspections', bulkRoutes);
    return app;
}

const get = (app: OpenAPIHono<HonoConfig>) => app.request('/api/inspections/inspectors', {}, FAKE_ENV);

describe('GET /api/inspections/inspectors — scheduleOthers gate', () => {
    it('owner is admitted (positive control)', async () => {
        expect((await get(buildApp('owner'))).status).toBe(200);
    });

    it('manager is admitted (positive control)', async () => {
        expect((await get(buildApp('manager'))).status).toBe(200);
    });

    it('an inspector granted scheduleOthers is admitted and sees the list (positive control)', async () => {
        const res = await get(buildApp('inspector', { scheduleOthers: true }));
        expect(res.status).toBe(200);
        expect(await res.text()).toContain('colleague@a.test');
    });

    it('a default inspector is refused and the body carries no account data', async () => {
        const res = await get(buildApp('inspector'));
        expect(res.status).toBe(403);
        expect(await res.text()).not.toContain('colleague@a.test');
    });
});
