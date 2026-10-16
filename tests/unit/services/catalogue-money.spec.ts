/**
 * The service catalogue carries a price. Reading it needs `inspectionFees` (the
 * new-inspection wizard prices a line from it); writing it needs `companyFinance`.
 * Holding the wrong one of the two changes nothing.
 */
import { describe, it, expect, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';
import type { UserRole } from '../../../server/types/auth';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
// eslint-disable-next-line import/order
import { servicesRoutes } from '../../../server/api/services';

const T = '00000000-0000-0000-0000-000000000001';
const ENV = { DB: {} } as HonoConfig['Bindings'];
const MONEY_KEY = /"(price|[A-Za-z]*Cents)"\s*:/;

function buildApp(role: UserRole, overrides: Record<string, boolean> | null = null) {
    const app = new OpenAPIHono<HonoConfig>();
    app.onError((err, c) => (err instanceof AppError
        ? c.json({ success: false, error: { code: err.code, message: err.message } }, err.status)
        : c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500)));
    app.use('*', async (c, next) => {
        c.set('tenantId', T);
        c.set('userRole', role);
        c.set('user', { sub: 'actor', role, tenantId: T });
        c.set('sdb', { getById: async () => ({ permissionOverrides: overrides }) } as unknown as HonoConfig['Variables']['sdb']);
        c.set('services', {
            service: { listServices: async () => [{ id: 's1', name: 'Radon', price: 15000, duration: 60 }] },
        } as unknown as HonoConfig['Variables']['services']);
        await next();
    });
    app.route('/api/services', servicesRoutes);
    return app;
}

const list = (app: OpenAPIHono<HonoConfig>) => app.request('/api/services', {}, ENV);

describe('GET /api/services', () => {
    it('positive control: a manager receives the price', async () => {
        const res = await list(buildApp('manager'));
        expect(res.status).toBe(200);
        expect(await res.text()).toMatch(MONEY_KEY);
    });
    it('an inspector with the default inspectionFees receives the price', async () => {
        const res = await list(buildApp('inspector'));
        expect(res.status).toBe(200);
        expect(await res.text()).toMatch(MONEY_KEY);
    });
    it('an inspector with inspectionFees switched off receives the list without a price', async () => {
        const res = await list(buildApp('inspector', { inspectionFees: false }));
        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).not.toMatch(MONEY_KEY);
        expect(text).toContain('Radon');
    });
    it('companyFinance alone does not bring the price back', async () => {
        const res = await list(buildApp('inspector', { inspectionFees: false, companyFinance: true }));
        expect(await res.text()).not.toMatch(MONEY_KEY);
    });
});
