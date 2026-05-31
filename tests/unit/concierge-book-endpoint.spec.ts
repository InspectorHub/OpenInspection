import { describe, it, expect, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import agentRoutes from '../../server/api/agent';
import type { HonoConfig } from '../../server/types/hono';

/**
 * Agent Accounts A3 — POST /api/agent/concierge-book integration shape.
 *
 * The endpoint is an authenticated agent route. We mount it on a fresh
 * OpenAPIHono and stub the auth context (agent role + agentUserId) plus a
 * minimal services object so we can assert request validation + service
 * dispatch without exercising D1/JWT plumbing.
 */
describe('POST /api/agent/concierge-book — A3', () => {
    function buildApp(stubs: { createBooking?: ReturnType<typeof vi.fn> } = {}) {
        const app = new OpenAPIHono<HonoConfig>();
        app.use('*', async (c, next) => {
            // Inject minimal context: agent role + dummy services proxy.
            c.set('userRole', 'agent');
            c.set('user', { sub: '00000000-0000-0000-0000-0000000000a2', role: 'agent', tenantId: '' });
            c.set('agentUserId', '00000000-0000-0000-0000-0000000000a2');
            // Provide a services proxy whose `concierge` method is the stub.
            const fakeServices = {
                concierge: {
                    createBooking: stubs.createBooking ?? vi.fn().mockResolvedValue({
                        inspectionId: 'b1b2b3b4-1234-4abc-9def-0123456789ab',
                        status: 'awaiting_client',
                    }),
                },
            };
            c.set('services', fakeServices as unknown as HonoConfig['Variables']['services']);
            await next();
        });
        app.route('/api/agent', agentRoutes);
        return app;
    }

    it('returns 200 with status awaiting_client when service resolves auto-mode', async () => {
        const stub = vi.fn().mockResolvedValue({
            inspectionId: 'b1b2b3b4-1234-4abc-9def-0123456789ab',
            status: 'awaiting_client',
        });
        const app = buildApp({ createBooking: stub });

        const res = await app.request('/api/agent/concierge-book', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tenantId: 'a4b1c2d3-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
                inspectorContactId: '00000000-0000-0000-0000-0000000000a4',
                date: '2026-06-15',
                timeSlot: '10:00',
                propertyAddress: '1 Main St',
                clientName: 'Sarah Buyer',
                clientEmail: 'sarah@example.com',
                agreementRequired: true,
                paymentRequired: false,
            }),
        });

        expect(res.status).toBe(200);
        const body = await res.json() as { success: boolean; data: { status: string; inspectionId: string } };
        expect(body.success).toBe(true);
        expect(body.data.status).toBe('awaiting_client');
        expect(body.data.inspectionId).toBe('b1b2b3b4-1234-4abc-9def-0123456789ab');
        expect(stub).toHaveBeenCalledTimes(1);
        // Verify the service got the agent's user id from the JWT context, not from request body.
        expect(stub.mock.calls[0]?.[0]?.agentUserId).toBe('00000000-0000-0000-0000-0000000000a2');
    });

    it('rejects malformed body with 400', async () => {
        const app = buildApp();
        const res = await app.request('/api/agent/concierge-book', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tenantId: 'not-a-uuid' }),
        });
        expect(res.status).toBe(400);
    });

    it('rejects missing client email', async () => {
        const app = buildApp();
        const res = await app.request('/api/agent/concierge-book', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tenantId: 'a4b1c2d3-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
                inspectorContactId: '00000000-0000-0000-0000-0000000000a4',
                date: '2026-06-15',
                timeSlot: '10:00',
                propertyAddress: '1 Main St',
                clientName: 'Sarah Buyer',
                // clientEmail missing
            }),
        });
        expect(res.status).toBe(400);
    });
});
