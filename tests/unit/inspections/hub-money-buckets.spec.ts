/**
 * GET /api/inspections/:id/hub carries two kinds of money in one response: the
 * price lines of the inspection (inspectionFees) and the invoice block with its
 * collected amounts (companyFinance). Each field is projected for its own
 * capability; one cannot stand in for the other.
 */
import { describe, it, expect, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import { inspectionsRoutes } from '../../../server/api/inspections';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';
import type { UserRole } from '../../../server/types/auth';

// The lifecycle facts have their own spec (hub-lifecycle.spec.ts); this one stubs the database away.
vi.mock('../../../server/lib/inspection/hub-lifecycle', () => ({
    hubLifecycle: async () => ({ moneyCollected: false, statusBeforeCancel: null }),
}));

const TENANT = '00000000-0000-0000-0000-000000000001';
const INSP_ID = '550e8400-e29b-41d4-a716-446655440000';

const HUB = {
    inspection: { id: INSP_ID, propertyAddress: '1 Main St', price: 45000 },
    people: [],
    services: [{ id: 's1', name: 'Radon', priceCents: 15000 }],
    agreements: [],
    agreementRequests: [],
    invoice: { id: 'inv-1', status: 'paid', amountCents: 45000, amountPaidCents: 45000, sentAt: null, paidAt: null },
    publishReadiness: { ready: true, blockingCount: 0 },
};

function buildApp(role: UserRole, overrides: Record<string, boolean> | null) {
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('userRole', role as never);
        c.set('tenantId', TENANT);
        c.set('user', { sub: 'user-1' } as never);
        c.set('requestedTenantSlug', 'acme' as never);
        c.set('sdb', { getById: async () => ({ permissionOverrides: overrides }) } as never);
        c.set('services', {
            inspection: { getInspectionHub: async () => structuredClone(HUB) },
            people: { getPrimaryClient: async () => null },
            portalAccess: { issueToken: async () => 'tok' },
        } as never);
        await next();
    });
    app.route('/api/inspections', inspectionsRoutes);
    app.onError((err, c) => {
        if (err instanceof AppError) return c.json({ success: false, error: { code: err.code } }, err.status as never);
        throw err;
    });
    return app;
}

const ENV = { DB: {}, APP_BASE_URL: 'https://acme.example.com', JWT_SECRET: 'test-secret' } as never;

async function hub(role: UserRole, overrides: Record<string, boolean> | null) {
    const res = await buildApp(role, overrides).request(`/api/inspections/${INSP_ID}/hub`, {}, ENV);
    expect(res.status).toBe(200);
    return (await res.json() as { data: { inspection: Record<string, unknown>; services: Array<Record<string, unknown>>; invoice: Record<string, unknown> } }).data;
}

describe('hub money, field by field', () => {
    it('positive control: a manager receives the price lines and the invoice amounts', async () => {
        const d = await hub('manager', null);
        expect(d.inspection.price).toBe(45000);
        expect(d.services[0]).toHaveProperty('priceCents');
        expect(d.invoice.amountCents).toBe(45000);
    });
    it('inspectionFees on, companyFinance off: price lines but no invoice amounts', async () => {
        const d = await hub('manager', { inspectionFees: true, companyFinance: false });
        expect(d.inspection.price).toBe(45000);
        expect(d.services[0]).toHaveProperty('priceCents');
        expect(d.invoice).not.toHaveProperty('amountCents');
        expect(d.invoice).not.toHaveProperty('amountPaidCents');
        expect(d.invoice.status).toBe('paid');
    });
    it('the default inspector is that case', async () => {
        const d = await hub('inspector', null);
        expect(d.inspection.price).toBe(45000);
        expect(d.invoice).not.toHaveProperty('amountCents');
    });
    it('companyFinance on, inspectionFees off: invoice amounts but no price lines', async () => {
        const d = await hub('manager', { inspectionFees: false, companyFinance: true });
        expect(d.inspection).not.toHaveProperty('price');
        expect(d.services[0]).not.toHaveProperty('priceCents');
        expect(d.services[0].name).toBe('Radon');
        expect(d.invoice.amountCents).toBe(45000);
    });
    it('neither: no money key anywhere', async () => {
        const d = await hub('manager', { inspectionFees: false, companyFinance: false });
        expect(JSON.stringify(d)).not.toMatch(/"(price|[A-Za-z]*Cents)"\s*:/);
        expect(d.inspection.propertyAddress).toBe('1 Main St');
    });
});
