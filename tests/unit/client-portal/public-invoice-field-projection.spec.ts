/**
 * IA-86 — the public invoice endpoint used to spread the whole DB row at the
 * payer (`{ ...inv, brand, tenantSlug }`).
 *
 * `PublicInvoiceBodySchema` declared ten fields, but hono/zod-openapi does not
 * validate or trim RESPONSES, so the declaration was decorative: `notes` (the
 * inspector's private note on the invoice), `qboSyncStatus` (QuickBooks
 * reconciliation state), `tenantId` and `contactId` all shipped to whoever held
 * the pay link. This is IA-33 boundary A word for word — that fix trimmed the
 * report endpoint and never revisited the invoice one.
 *
 * The declaration is now the behaviour: the handler projects through the schema,
 * so a field that is not declared cannot leave.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

import { OpenAPIHono } from '@hono/zod-openapi';
import type { HonoConfig } from '../../../server/types/hono';
import { PortalAccessService } from '../../../server/services/portal-access.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import publicReportRoutes from '../../../server/api/public-report';

const TENANT = '00000000-0000-0000-0000-0000000000b1';
const SECRET = 'test-jwt-secret';
const INSP = 'insp-ia86-1';

/** Everything InvoiceService.findByInspectionId actually returns for a row. */
const FULL_ROW = {
    id: 'inv-1',
    tenantId: TENANT,
    inspectionId: INSP,
    contactId: 'contact-secret',
    clientName: 'Dana Buyer',
    clientEmail: 'dana@example.com',
    amountCents: 5000,
    lineItems: [{ description: 'Home inspection', amountCents: 5000 }],
    dueDate: '2026-08-01',
    notes: 'Client haggled; do not discount again.',
    sentAt: '2026-07-01T00:00:00.000Z',
    paidAt: null,
    paymentMethod: 'check',
    partialPaidAt: null,
    voidedAt: null,
    qboSyncStatus: 'failed',
    createdAt: '2026-07-01T00:00:00.000Z',
    currency: 'USD',
    status: 'sent',
};

const LEAKED = ['tenantId', 'contactId', 'notes', 'qboSyncStatus', 'paymentMethod', 'partialPaidAt', 'voidedAt', 'clientEmail', 'sentAt'] as const;
const KEPT = ['id', 'amountCents', 'currency', 'status', 'createdAt', 'dueDate', 'clientName', 'lineItems', 'brand', 'tenantSlug'] as const;

describe('IA-86 — public invoice response carries only declared fields', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let portalAccess: PortalAccessService;
    let token: string;

    function buildApp() {
        const app = new OpenAPIHono<HonoConfig>();
        app.use('*', async (c, next) => {
            (c as unknown as { env: Record<string, unknown> }).env = { DB: {}, JWT_SECRET: SECRET };
            c.set('resolvedTenantId', TENANT as never);
            c.set('services', {
                portalAccess,
                invoice: { findByInspectionId: vi.fn().mockResolvedValue(FULL_ROW) },
                branding: { getBrand: vi.fn().mockResolvedValue({ companyName: 'Acme', logoUrl: null, primaryColor: null, defaultTimezone: 'UTC' }) },
            } as unknown as HonoConfig['Variables']['services']);
            await next();
        });
        app.route('/api/public', publicReportRoutes);
        return app;
    }

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        await testDb.insert(schema.tenants).values({
            id: TENANT, name: 'Acme', slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await seedRoleProfiles(testDb, TENANT);
        portalAccess = new PortalAccessService({} as D1Database, { jwtSecret: SECRET });
        token = await portalAccess.issueToken({ tenantId: TENANT, inspectionId: INSP, recipientEmail: 'dana@example.com' });
    });

    async function fetchInvoice() {
        const res = await buildApp().request(`/api/public/inspections/${INSP}/invoice?token=${encodeURIComponent(token)}`);
        expect(res.status).toBe(200);
        return (await res.json()) as { data: Record<string, unknown> };
    }

    it('does not ship internal fields to the payer', async () => {
        const { data } = await fetchInvoice();
        for (const field of LEAKED) expect(data).not.toHaveProperty(field);
    });

    it('still ships everything the pay page renders', async () => {
        const { data } = await fetchInvoice();
        for (const field of KEPT) expect(data).toHaveProperty(field);
        expect(data.amountCents).toBe(5000);
        expect(data.status).toBe('sent');
        expect(data.tenantSlug).toBe('acme');
        expect(data.lineItems).toEqual([{ description: 'Home inspection', amountCents: 5000 }]);
    });

    it('the raw text of the response contains no private note', async () => {
        const res = await buildApp().request(`/api/public/inspections/${INSP}/invoice?token=${encodeURIComponent(token)}`);
        expect(await res.text()).not.toContain('do not discount again');
    });

    it('a null invoice still answers 200 with null data', async () => {
        const app = new OpenAPIHono<HonoConfig>();
        app.use('*', async (c, next) => {
            (c as unknown as { env: Record<string, unknown> }).env = { DB: {}, JWT_SECRET: SECRET };
            c.set('resolvedTenantId', TENANT as never);
            c.set('services', {
                portalAccess,
                invoice: { findByInspectionId: vi.fn().mockResolvedValue(null) },
                branding: { getBrand: vi.fn() },
            } as unknown as HonoConfig['Variables']['services']);
            await next();
        });
        app.route('/api/public', publicReportRoutes);
        const res = await app.request(`/api/public/inspections/${INSP}/invoice?token=${encodeURIComponent(token)}`);
        expect(res.status).toBe(200);
        expect((await res.json() as { data: unknown }).data).toBeNull();
    });
});
