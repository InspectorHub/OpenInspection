import { describe, it, expect, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import agentRoutes from '../../server/api/agent';
import agentsRoutes from '../../server/api/agents';
import type { HonoConfig } from '../../server/types/hono';

/**
 * C-10 ③-C — thin route wiring over EXISTING AgentService methods
 * (listReferrals/listInspectors/resolveInvite, all service-tested elsewhere).
 * These tests cover only the new route layer: it calls the service with the
 * right args and shapes the response. RBAC gating is requireRole's job
 * (covered by agent-middleware.spec), so we mount with an 'agent' role.
 */
describe('agent C-10 routes', () => {
    function agentApp(services: Record<string, unknown>) {
        const app = new OpenAPIHono<HonoConfig>();
        app.use('*', async (c, next) => {
            c.set('userRole', 'agent');
            c.set('user', { sub: 'u1' } as never);
            c.set('tenantId', 't1');
            c.set('services', services as never);
            await next();
        });
        app.route('/api/agent', agentRoutes);
        return app;
    }
    function agentsApp(services: Record<string, unknown>) {
        const app = new OpenAPIHono<HonoConfig>();
        app.use('*', async (c, next) => { c.set('services', services as never); await next(); });
        app.route('/api/agents', agentsRoutes);
        return app;
    }

    it('GET /api/agent/referrals returns listReferrals data, called with (userId, {limit})', async () => {
        const listReferrals = vi.fn().mockResolvedValue([
            { id: 'i1', tenantName: 'Acme', propertyAddress: '1 Main', clientName: 'Bob', date: '2026-06-01', status: 'delivered', inspectorName: 'Pat' },
        ]);
        const res = await agentApp({ agent: { listReferrals } }).request('/api/agent/referrals');
        expect(res.status).toBe(200);
        const body = await res.json() as { success: boolean; data: { id: string }[] };
        expect(body.success).toBe(true);
        expect(body.data[0].id).toBe('i1');
        expect(listReferrals).toHaveBeenCalledWith('u1', { limit: 100 });
    });

    it('GET /api/agent/inspectors returns listInspectors data, called with userId', async () => {
        const listInspectors = vi.fn().mockResolvedValue([
            { inspectorName: 'Pat', inspectorSlug: 'pat', inspectorPhotoUrl: null, tenantName: 'Acme', tenantSubdomain: 'acme' },
        ]);
        const res = await agentApp({ agent: { listInspectors } }).request('/api/agent/inspectors');
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { inspectorSlug: string }[] };
        expect(body.data[0].inspectorSlug).toBe('pat');
        expect(listInspectors).toHaveBeenCalledWith('u1');
    });

    it('GET /api/agents/invite-info maps resolveInvite (email→inviteEmail, inspector.name)', async () => {
        const resolveInvite = vi.fn().mockResolvedValue({
            token: 'tok', email: 'jane@realty.com', tenantId: 't1', tenantName: 'Acme',
            inspector: { id: 'u9', name: 'Pat' }, inviterEmail: 'pat@a.com', expired: false, used: false,
        });
        const res = await agentsApp({ agent: { resolveInvite } }).request('/api/agents/invite-info?token=tok');
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { inviteEmail: string; tenantName: string; inspector: { name: string } } };
        expect(body.data.inviteEmail).toBe('jane@realty.com');
        expect(body.data.tenantName).toBe('Acme');
        expect(body.data.inspector.name).toBe('Pat');
        expect(resolveInvite).toHaveBeenCalledWith('tok');
    });

    it('GET /api/agents/invite-info 404 when the invite is expired or used', async () => {
        const resolveInvite = vi.fn().mockResolvedValue({
            token: 'tok', email: 'x', tenantId: 't1', tenantName: 'Acme',
            inspector: { id: 'u9', name: 'Pat' }, inviterEmail: null, expired: true, used: false,
        });
        const res = await agentsApp({ agent: { resolveInvite } }).request('/api/agents/invite-info?token=tok');
        expect(res.status).toBe(404);
    });

    it('GET /api/agents/invite-info 404 when no invite matches', async () => {
        const res = await agentsApp({ agent: { resolveInvite: vi.fn().mockResolvedValue(null) } }).request('/api/agents/invite-info?token=nope');
        expect(res.status).toBe(404);
    });
});
