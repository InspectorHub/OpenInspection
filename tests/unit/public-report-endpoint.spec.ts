import { describe, it, expect, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import publicReportRoutes from '../../server/api/public-report';
import type { HonoConfig } from '../../server/types/hono';

/**
 * C-10 ③-A.1 — GET /api/public/report/:tenant/:id integration shape.
 * Public, no-login: token gates access; tenantId comes from the token row,
 * never the URL. We stub portalAccess.resolveToken + inspection.getReportData.
 */
describe('GET /api/public/report/:tenant/:id — ③-A.1', () => {
    const tokenRow = (over: Partial<Record<string, unknown>> = {}) => ({
        inspectionId: 'insp1', tenantId: 't1', role: 'client', recipientEmail: 'a@b.com',
        revokedAt: null, expiresAt: null, ...over,
    });

    function buildApp(resolveToken: ReturnType<typeof vi.fn>, getReportData = vi.fn().mockResolvedValue({ inspectionId: 'insp1' })) {
        const app = new OpenAPIHono<HonoConfig>();
        app.use('*', async (c, next) => {
            c.set('services', { portalAccess: { resolveToken }, inspection: { getReportData } } as unknown as HonoConfig['Variables']['services']);
            await next();
        });
        app.route('/api/public', publicReportRoutes);
        return { app, getReportData };
    }

    it('404 when no token', async () => {
        const { app } = buildApp(vi.fn());
        const res = await app.request('/api/public/report/t/insp1');
        expect(res.status).toBe(404);
    });

    it('404 when the token maps to a different inspection', async () => {
        const { app } = buildApp(vi.fn().mockResolvedValue(tokenRow({ inspectionId: 'other' })));
        const res = await app.request('/api/public/report/t/insp1?token=tok');
        expect(res.status).toBe(404);
    });

    it('200 with report data + queries by the token tenantId (not the URL)', async () => {
        const { app, getReportData } = buildApp(vi.fn().mockResolvedValue(tokenRow()));
        const res = await app.request('/api/public/report/WRONG-TENANT/insp1?token=tok');
        expect(res.status).toBe(200);
        const body = await res.json() as { success: boolean; data: unknown };
        expect(body.success).toBe(true);
        expect(getReportData).toHaveBeenCalledWith('insp1', 't1');
    });
});
