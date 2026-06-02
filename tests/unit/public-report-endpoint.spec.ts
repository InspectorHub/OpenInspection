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

    function buildApp(
        resolveToken: ReturnType<typeof vi.fn>,
        getReportData = vi.fn().mockResolvedValue({ inspectionId: 'insp1' }),
        resolveAgentViewToken = vi.fn().mockResolvedValue(null),
    ) {
        const app = new OpenAPIHono<HonoConfig>();
        app.use('*', async (c, next) => {
            c.set('services', { portalAccess: { resolveToken }, inspection: { getReportData, resolveAgentViewToken } } as unknown as HonoConfig['Variables']['services']);
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

    it('200 via the legacy KV agent-view-token fallback (existing share links)', async () => {
        const getReportData = vi.fn().mockResolvedValue({ inspectionId: 'insp1' });
        const legacy = vi.fn().mockResolvedValue({ inspectionId: 'insp1', tenantId: 't9' });
        const { app } = buildApp(vi.fn().mockResolvedValue(null), getReportData, legacy);
        const res = await app.request('/api/public/report/t/insp1?token=kvtok');
        expect(res.status).toBe(200);
        expect(getReportData).toHaveBeenCalledWith('insp1', 't9');
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

/**
 * C-10 ③-A.4 — GET /api/public/observe/inspections/:id?token=
 * Live observer view, gated by an OBSERVER-link token (distinct from the portal
 * token). tenantId comes from the claimed observer link, never the URL.
 */
describe('GET /api/public/observe/inspections/:id — ③-A.4', () => {
    function buildApp(
        claim: ReturnType<typeof vi.fn>,
        getObserveProgress = vi.fn().mockResolvedValue({
            address: '1 Main St', date: '2026-06-01', inspectorName: 'Pat', status: 'in_progress', sections: [],
        }),
    ) {
        const app = new OpenAPIHono<HonoConfig>();
        app.use('*', async (c, next) => {
            c.set('services', { observerLink: { claim }, inspection: { getObserveProgress } } as unknown as HonoConfig['Variables']['services']);
            await next();
        });
        app.route('/api/public', publicReportRoutes);
        return { app, getObserveProgress };
    }

    it('404 when no token', async () => {
        const { app } = buildApp(vi.fn());
        const res = await app.request('/api/public/observe/inspections/insp1');
        expect(res.status).toBe(404);
    });

    it('404 when the observer link is not claimable', async () => {
        const { app } = buildApp(vi.fn().mockResolvedValue({ kind: 'expired' }));
        const res = await app.request('/api/public/observe/inspections/insp1?token=tok');
        expect(res.status).toBe(404);
    });

    it('404 when the token claims a different inspection', async () => {
        const { app } = buildApp(vi.fn().mockResolvedValue({ kind: 'ok', inspectionId: 'other', tenantId: 't1' }));
        const res = await app.request('/api/public/observe/inspections/insp1?token=tok');
        expect(res.status).toBe(404);
    });

    it('200 with progress + queries by the claimed tenantId (not the URL)', async () => {
        const { app, getObserveProgress } = buildApp(
            vi.fn().mockResolvedValue({ kind: 'ok', inspectionId: 'insp1', tenantId: 't1' }),
        );
        const res = await app.request('/api/public/observe/inspections/insp1?token=tok');
        expect(res.status).toBe(200);
        const body = await res.json() as { success: boolean; data: { address: string } };
        expect(body.success).toBe(true);
        expect(body.data.address).toBe('1 Main St');
        expect(getObserveProgress).toHaveBeenCalledWith('insp1', 't1');
    });
});

/**
 * C-10 ③-A.2 — GET /api/public/report-gate/:tenant/:id
 * Public "report blocked, here's why + CTA" page. tenantId resolves from the
 * subdomain (middleware), never the URL :tenant. No token (pre-report).
 */
describe('GET /api/public/report-gate/:tenant/:id — ③-A.2', () => {
    function buildApp(
        tenantId: string | null,
        getReportGate = vi.fn().mockResolvedValue({
            reason: 'payment', companyName: 'Acme', primaryColor: '#123456',
            actionUrl: '/r/insp1/invoice', actionLabel: 'Pay invoice',
            propertyAddress: '1 Main St', inspectorName: 'Pat', inspectorEmail: null,
            inspectorPhone: null, inspectorLicense: null, scheduledDate: '2026-06-01',
            amountCents: 45000, currency: 'USD',
        }),
    ) {
        const app = new OpenAPIHono<HonoConfig>();
        app.use('*', async (c, next) => {
            if (tenantId) c.set('tenantId', tenantId);
            c.set('services', { inspection: { getReportGate } } as unknown as HonoConfig['Variables']['services']);
            await next();
        });
        app.route('/api/public', publicReportRoutes);
        return { app, getReportGate };
    }

    it('404 when the tenant subdomain does not resolve', async () => {
        const { app } = buildApp(null);
        const res = await app.request('/api/public/report-gate/acme/insp1');
        expect(res.status).toBe(404);
    });

    it('200 with the gate payload + queries by the resolved tenantId (not the URL)', async () => {
        const { app, getReportGate } = buildApp('t1');
        const res = await app.request('/api/public/report-gate/WRONG-TENANT/insp1');
        expect(res.status).toBe(200);
        const body = await res.json() as { success: boolean; data: { reason: string; amountCents: number } };
        expect(body.success).toBe(true);
        expect(body.data.reason).toBe('payment');
        expect(body.data.amountCents).toBe(45000);
        expect(getReportGate).toHaveBeenCalledWith('insp1', 't1', 'WRONG-TENANT');
    });
});
