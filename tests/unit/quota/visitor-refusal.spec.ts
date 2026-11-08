import { describe, it, expect, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import agentRoutes from '../../../server/api/agent';
import { AppError, Errors } from '../../../server/lib/errors';
import { neutralBookingRefusal, NEUTRAL_BOOKING_REFUSAL } from '../../../server/features/plan-quota/visitor-refusal';
import type { HonoConfig } from '../../../server/types/hono';

const SPENT = () => Errors.QuotaExhausted({
    metric: 'inspections', used: 5, cap: 5, billingPortalUrl: 'https://billing.example.test',
    period: '2026-11', resetsAt: '2026-12-01T00:00:00.000Z',
});

describe('neutralBookingRefusal', () => {
    it('turns a spent inspection allowance into a plain 409 that names no plan', () => {
        const out = neutralBookingRefusal(SPENT());
        expect(out).toMatchObject({ status: 409, message: NEUTRAL_BOOKING_REFUSAL });
        expect(out?.message).not.toMatch(/plan|free|subscribe|limit|quota|billing|\d\/\d/i);
    });
    it('leaves every other error alone', () => {
        expect(neutralBookingRefusal(Errors.QuotaExhausted({ metric: 'email', used: 50, cap: 50, billingPortalUrl: null }))).toBeNull();
        expect(neutralBookingRefusal(Errors.NotFound('x'))).toBeNull();
        expect(neutralBookingRefusal(new Error('boom'))).toBeNull();
    });
});

describe('POST /api/agent/concierge-book at the company\'s monthly cap', () => {
    const body = {
        tenantId: 'tenant-1', date: '2026-11-20', timeSlot: '9:00 AM', propertyAddress: '1 Main St',
        clientName: 'Pat', clientEmail: 'pat@example.test',
    };
    function appWith(createBooking: () => Promise<never>) {
        const app = new OpenAPIHono<HonoConfig>();
        app.onError((err, c) => err instanceof AppError
            ? c.json({ success: false, error: { code: err.code, message: err.message } }, err.status)
            : c.json({ success: false, error: { code: 'internal_error', message: String(err) } }, 500));
        app.use('*', async (c, next) => {
            c.set('userRole', 'agent');
            c.set('agentUserId', 'agent-1');
            c.set('user', { sub: 'agent-1' } as never);
            c.set('profile', { hasUsageQuota: false } as never);
            c.set('services', { concierge: { createBooking } } as never);
            await next();
        });
        app.route('/api/agent', agentRoutes);
        return app;
    }
    const post = (app: OpenAPIHono<HonoConfig>) => app.request('/api/agent/concierge-book', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }, {} as never, { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as never);

    it('shows the referring agent a neutral message, not the plan wording', async () => {
        const res = await post(appWith(async () => { throw SPENT(); }));
        expect(res.status).toBe(409);
        const json = await res.json() as { error: { code: string; message: string } };
        expect(json.error.code).not.toBe('QUOTA_EXHAUSTED');
        expect(json.error.message).toBe(NEUTRAL_BOOKING_REFUSAL);
    });

    it('other failures still surface as themselves', async () => {
        const res = await post(appWith(async () => { throw Errors.Forbidden('not linked'); }));
        expect(res.status).toBe(403);
    });
});
