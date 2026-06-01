import { describe, it, expect, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import coreAuthRoutes from '../../server/api/auth';
import type { HonoConfig } from '../../server/types/hono';

/**
 * C-10 ③-B — thin route layer over AuthService.getInviteInfo / isSetUp
 * (both service-tested in auth.service.spec). Covers the route wiring:
 * 404-on-null for invite-info, and the setup-status shape.
 */
describe('auth C-10 routes', () => {
    function buildApp(auth: Record<string, unknown>) {
        const app = new OpenAPIHono<HonoConfig>();
        app.use('*', async (c, next) => {
            c.set('services', { auth } as unknown as HonoConfig['Variables']['services']);
            await next();
        });
        app.route('/api/auth', coreAuthRoutes);
        return app;
    }

    it('GET /api/auth/invite-info maps the resolved invite', async () => {
        const getInviteInfo = vi.fn().mockResolvedValue({ email: 'a@b.com', workspaceName: 'Acme' });
        const res = await buildApp({ getInviteInfo }).request('/api/auth/invite-info?token=tok');
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { email: string; workspaceName: string } };
        expect(body.data).toEqual({ email: 'a@b.com', workspaceName: 'Acme' });
        expect(getInviteInfo).toHaveBeenCalledWith('tok');
    });

    it('GET /api/auth/invite-info 404 when the invite does not resolve', async () => {
        const res = await buildApp({ getInviteInfo: vi.fn().mockResolvedValue(null) }).request('/api/auth/invite-info?token=nope');
        expect(res.status).toBe(404);
    });

    it('GET /api/auth/setup-status reports isSetUp', async () => {
        const res = await buildApp({ isSetUp: vi.fn().mockResolvedValue(true) }).request('/api/auth/setup-status');
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { isSetUp: boolean } };
        expect(body.data.isSetUp).toBe(true);
    });
});
