/**
 * IA-36 ⑨ — a report link we took offline must not answer with a bare 404.
 *
 * The recipient was legitimately invited; the link stopped working because of
 * OUR policy (an expiry we set, or a reset/removal an operator performed). "Not
 * found" tells them they did something wrong. The endpoint answers 410 Gone
 * with a distinguishable code so the page can say what happened and what to do
 * next, while a token that never existed still gets the ordinary 404.
 */
import { describe, it, expect, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import publicReportRoutes from '../../../server/api/public-report';
import type { HonoConfig } from '../../../server/types/hono';
import { classifyPortalAccess } from '../../../server/lib/public-access';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const live = { inspectionId: 'insp1', tenantId: 't1', role: 'client', recipientEmail: 'a@b.com', revokedAt: null, expiresAt: null };

describe('classifyPortalAccess', () => {
    const svc = (row: unknown) => ({ resolveToken: async () => row as never });

    it('unknown for no token / no row / wrong inspection', async () => {
        expect(await classifyPortalAccess(svc(live), undefined, 'insp1')).toBe('unknown');
        expect(await classifyPortalAccess(svc(null), 'x', 'insp1')).toBe('unknown');
        expect(await classifyPortalAccess(svc({ ...live, inspectionId: 'other' }), 'x', 'insp1')).toBe('unknown');
    });

    it('expired when the expiry has passed', async () => {
        expect(await classifyPortalAccess(svc({ ...live, expiresAt: 1 }), 'x', 'insp1', 2)).toBe('expired');
    });

    it('revoked outranks expired — a revoked link never comes back by relaxing the policy', async () => {
        expect(await classifyPortalAccess(svc({ ...live, revokedAt: 1, expiresAt: 1 }), 'x', 'insp1', 2)).toBe('revoked');
    });

    it('active for a live link', async () => {
        expect(await classifyPortalAccess(svc(live), 'x', 'insp1', 2)).toBe('active');
    });
});

describe('GET /api/public/report/:tenant/:id with a link we took offline', () => {
    function buildApp(row: unknown) {
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
            select: () => ({ from: () => ({ where: () => ({ get: async () => ({ reportStatus: 'published' }) }) }) }),
        });
        const app = new OpenAPIHono<HonoConfig>();
        app.use('*', async (c, next) => {
            (c as unknown as { env: Record<string, unknown> }).env = { DB: {} };
            c.set('services', {
                portalAccess: { resolveToken: async () => row },
                inspection: { getReportData: async () => ({ inspectionId: 'insp1' }), resolveAgentViewToken: async () => null },
            } as never);
            await next();
        });
        app.route('/api/public', publicReportRoutes);
        return app;
    }

    it('410 REPORT_LINK_EXPIRED for an expired link', async () => {
        const res = await buildApp({ ...live, expiresAt: 1 }).request('/api/public/report/t/insp1?token=tok');
        expect(res.status).toBe(410);
        const body = await res.json() as { error: { code: string } };
        expect(body.error.code).toBe('REPORT_LINK_EXPIRED');
    });

    it('410 REPORT_LINK_REVOKED for a link that was reset or whose holder left', async () => {
        const res = await buildApp({ ...live, revokedAt: 1 }).request('/api/public/report/t/insp1?token=tok');
        expect(res.status).toBe(410);
        const body = await res.json() as { error: { code: string } };
        expect(body.error.code).toBe('REPORT_LINK_REVOKED');
    });

    it('still a plain 404 for a token that names nothing — no probe oracle for guessed tokens', async () => {
        const res = await buildApp(null).request('/api/public/report/t/insp1?token=guess');
        expect(res.status).toBe(404);
    });

    it('still a plain 404 when no token is presented at all', async () => {
        const res = await buildApp(null).request('/api/public/report/t/insp1');
        expect(res.status).toBe(404);
    });
});
