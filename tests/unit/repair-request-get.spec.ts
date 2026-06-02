import { describe, it, expect, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import repairRequestRoutes from '../../server/api/repair-requests';
import type { HonoConfig } from '../../server/types/hono';

/**
 * C-10 ③-D — GET /api/public/repair-request/:id
 * Public (subdomain-resolved tenant, unguessable id) repair-request page data.
 * tenantId comes from the resolved subdomain, never the URL. Thin wrapper over
 * inspection.getRepairRequestData.
 */
describe('GET /api/public/repair-request/:id — ③-D', () => {
    function buildApp(tenantId: string | null, getRepairRequestData: ReturnType<typeof vi.fn>) {
        const app = new OpenAPIHono<HonoConfig>();
        app.use('*', async (c, next) => {
            if (tenantId) c.set('tenantId', tenantId);
            c.set('services', { inspection: { getRepairRequestData } } as unknown as HonoConfig['Variables']['services']);
            await next();
        });
        app.route('/api/public', repairRequestRoutes);
        return app;
    }

    it('404 when the tenant subdomain does not resolve', async () => {
        const res = await buildApp(null, vi.fn()).request('/api/public/repair-request/i1');
        expect(res.status).toBe(404);
    });

    it('200 returns repair-request data, scoped by the resolved tenantId (not the URL)', async () => {
        const fn = vi.fn().mockResolvedValue({
            inspectionId: 'i1', propertyAddress: '1 Main', inspectionDate: '2026-06-01',
            inspectorName: 'Pat', clientEmail: 'buyer@x.com', defects: [], showEstimates: true,
        });
        const res = await buildApp('t1', fn).request('/api/public/repair-request/i1');
        expect(res.status).toBe(200);
        const body = await res.json() as { success: boolean; data: { inspectionId: string; clientEmail: string } };
        expect(body.success).toBe(true);
        expect(body.data.inspectionId).toBe('i1');
        expect(body.data.clientEmail).toBe('buyer@x.com');
        expect(fn).toHaveBeenCalledWith('i1', 't1');
    });
});
