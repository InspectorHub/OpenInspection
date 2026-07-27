/**
 * IA-57 — the trade must survive the whole write→read round trip, not just each
 * hop in isolation.
 *
 * Every other spec for this field stubs one side: the route specs stub the
 * service, the service specs skip the route. A field can pass all of them and
 * still never reach a reader (a column written under one name and read under
 * another is exactly the failure mode the IA audit kept finding). This spec
 * wires the REAL RepairRequestService over a real SQLite database into the REAL
 * share route and asserts the trade appears in the HTTP response body under the
 * key the public page actually reads (`tradeSnapshot`).
 */
import { describe, it, expect, vi } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
vi.mock('../../../server/lib/public-access', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../server/lib/public-access')>();
    return {
        ...actual,
        resolveOwnerPreviewFull: vi.fn().mockResolvedValue(null),
        resolveAgentSession: vi.fn().mockResolvedValue(null),
    };
});

// eslint-disable-next-line import/order
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
// eslint-disable-next-line import/order
import repairBuilderRoutes from '../../../server/api/repair-builder';
// eslint-disable-next-line import/order
import { RepairRequestService } from '../../../server/services/repair-request.service';
// eslint-disable-next-line import/order
import { createTestDb, setupSchema } from '../db';
// eslint-disable-next-line import/order
import * as schema from '../../../server/lib/db/schema';

const TENANT = '00000000-0000-0000-0000-0000000000aa';
const INSP   = '11111111-1111-1111-1111-1111111111bb';

describe('repair share round trip — trade (IA-57)', () => {
    it('a trade written by the builder comes back on the public share payload', async () => {
        const fixture = createTestDb();
        await setupSchema(fixture.sqlite);
        const testDb = fixture.db;

        await testDb.insert(schema.tenants).values({
            id: TENANT, name: 'Acme', slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
        await testDb.insert(schema.inspections).values({
            id: INSP, tenantId: TENANT, propertyAddress: '9 Elm St',
            clientName: 'C', clientEmail: 'c@example.com', date: '2026-06-01',
            status: 'completed', reportStatus: 'published', paymentStatus: 'unpaid',
            price: 0, paymentRequired: false, agreementRequired: false, createdAt: new Date(),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);

        // The route's publish gate and the service each call drizzle() with their
        // own binding; both resolve to the one real database here.
        const SERVICE_DB = {} as D1Database;
        const ENV_DB     = {} as D1Database;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockImplementation(() => testDb);

        const repairRequest = new RepairRequestService(SERVICE_DB);
        const rr = await repairRequest.create(TENANT, INSP, { kind: 'client', ref: 'buyer@example.com' });
        await repairRequest.addItem(TENANT, rr.id, {
            findingKey:   'canned:s1:i1:roof',
            sectionTitle: 'Roof',
            itemLabel:    'Shingles',
            defectTitle:  'Missing shingles',
            trade:        'licensed roofer',
        });

        const app = new OpenAPIHono();
        app.use('*', async (c, next) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            c.env = { DB: ENV_DB } as any;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            c.set('services' as never, { repairRequest } as any);
            await next();
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        app.route('/api/public', repairBuilderRoutes as any);

        const res = await app.request(`/api/public/repair-request/share/${rr.shareToken}`);
        expect(res.status).toBe(200);

        const body = await res.json() as {
            data: { items: Array<{ tradeSnapshot?: string | null }> };
        };
        expect(body.data.items).toHaveLength(1);
        // The exact key `app/routes/public/repair-request.$shareToken.tsx` reads.
        expect(body.data.items[0]!.tradeSnapshot).toBe('licensed roofer');
    });
});
