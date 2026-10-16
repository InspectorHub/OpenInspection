/**
 * POST /api/invoices/request-payment is gated by the `inspectionFees`
 * capability on top of its role gate. Inspectors and staff hold it by default,
 * so default behaviour is unchanged; one who has it switched off is refused
 * before the handler runs. Positive controls admit the same request.
 */
import { describe, it, expect } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';
import invoiceRoutes from '../../../server/api/invoices';
import { AppError } from '../../../server/lib/errors';
import type { HonoConfig } from '../../../server/types/hono';

async function call(role: string, overrides: Record<string, boolean> | null): Promise<number> {
    const app = new OpenAPIHono<HonoConfig>();
    app.use('*', async (c, next) => {
        c.set('userRole', role as never);
        c.set('tenantId', 't1');
        c.set('user', { sub: 'u1' } as never);
        c.set('sdb', { getById: async () => ({ permissionOverrides: overrides }) } as never);
        c.set('services', {} as never);
        await next();
    });
    app.route('/api/invoices', invoiceRoutes);
    // A request that gets past the gates reaches the handler, which fails on the
    // empty service bag: 500 here means "the gate let it through".
    app.onError((err, c) => (err instanceof AppError
        ? c.json({ error: err.message }, err.status as never)
        : c.json({ error: 'reached handler' }, 500)));
    const res = await app.request('/api/invoices/request-payment', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ inspectionId: '550e8400-e29b-41d4-a716-446655440000' }),
    }, { DB: {} } as never);
    return res.status;
}

describe('request-payment requires inspectionFees', () => {
    it('refuses an inspector and a staff member whose inspectionFees was withdrawn', async () => {
        expect(await call('inspector', { inspectionFees: false })).toBe(403);
        expect(await call('staff', { inspectionFees: false })).toBe(403);
    });

    it('admits the defaults (positive control): inspector, staff, manager, owner', async () => {
        for (const role of ['inspector', 'staff', 'manager', 'owner']) {
            expect(await call(role, null)).not.toBe(403);
        }
    });
});
