/**
 * The public invoice endpoint answers the payer with the fields `PublicInvoiceBodySchema` declares and no others.
 *
 * hono/zod-openapi does not validate or trim RESPONSES, so a declaration alone does not decide what a response carries.
 * The handler therefore projects through the schema: `notes` (the inspector's private note on the invoice), `qboSyncStatus`
 * (QuickBooks reconciliation state), `tenantId` and `contactId` are columns of the row and are not declared, so they are
 * not stated to whoever holds the pay link.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb, setupSchema } from '../db';
import { asD1Db } from '../helpers/test-db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import { lazyD1 } from '../helpers/d1-binding';
const testD1 = lazyD1();

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
    amountPaidCents: 2000,
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

const WITHHELD = ['tenantId', 'contactId', 'notes', 'qboSyncStatus', 'paymentMethod', 'partialPaidAt', 'voidedAt', 'clientEmail', 'sentAt'] as const;
const KEPT = ['id', 'amountCents', 'amountPaidCents', 'currency', 'status', 'createdAt', 'dueDate', 'clientName', 'lineItems', 'brand', 'tenantSlug', 'balanceDueCents'] as const;

describe('IA-86 — public invoice response carries only declared fields', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let portalAccess: PortalAccessService;
    let token: string;

    function buildApp() {
        const app = new OpenAPIHono<HonoConfig>();
        app.use('*', async (c, next) => {
            (c as unknown as { env: Record<string, unknown> }).env = { DB: testD1.binding, JWT_SECRET: SECRET };
            c.set('resolvedTenantId', TENANT as never);
            c.set('services', {
                portalAccess,
                invoice: { findByInspectionId: vi.fn().mockResolvedValue(FULL_ROW) },
                branding: { getBrand: vi.fn().mockResolvedValue({ companyName: 'Acme', legalName: 'Acme Inspections LLC', logoUrl: null, primaryColor: null, defaultTimezone: 'UTC', defaultLocale: 'de-DE', dateFormat: 'eu', timeFormat: '24h' }) },
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
        testD1.use(testDb);
        await testDb.insert(schema.tenants).values({
            id: TENANT, slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await seedRoleProfiles(asD1Db(testDb), TENANT);
        portalAccess = new PortalAccessService(testD1.binding, { jwtSecret: SECRET });
        token = await portalAccess.issueToken({ tenantId: TENANT, inspectionId: INSP, recipientEmail: 'dana@example.com' });
    });

    async function fetchInvoice() {
        const res = await buildApp().request(`/api/public/inspections/${INSP}/invoice?token=${encodeURIComponent(token)}`);
        expect(res.status).toBe(200);
        return (await res.json()) as { data: Record<string, unknown> };
    }

    it('does not state internal fields to the payer', async () => {
        const { data } = await fetchInvoice();
        for (const field of WITHHELD) expect(data).not.toHaveProperty(field);
    });

    it('still states everything the pay page renders', async () => {
        const { data } = await fetchInvoice();
        for (const field of KEPT) expect(data).toHaveProperty(field);
        expect(data.amountCents).toBe(5000);
        expect(data.status).toBe('sent');
        expect(data.tenantSlug).toBe('acme');
        expect(data.lineItems).toEqual([{ description: 'Home inspection', amountCents: 5000 }]);
    });

    /**
     * The projection cuts both ways: it keeps undeclared fields out, and it
     * silently DROPS a field someone forgot to declare. `amountPaidCents` was
     * added to `invoices` and populated by the QuickBooks sync while this schema
     * said nothing about it — so the column was written, the row carried it, and
     * zod removed it one line before the payer's page. Nothing failed; the value
     * simply never arrived. Pin it, because the next money column will land the
     * same way.
     */
    it('states the amount already received, which the schema declares', async () => {
        const { data } = await fetchInvoice();
        expect(data.amountPaidCents).toBe(2000);
    });

    it('states the balance still owed, the figure the pay page asks for', async () => {
        const { data } = await fetchInvoice();
        expect(typeof data.balanceDueCents).toBe('number');
        expect(data.balanceDueCents).toBeGreaterThanOrEqual(0);
    });

    it('carries exactly the declared keys, and the brand states the legal entity and the display format of the company', async () => {
        const { data } = await fetchInvoice();
        expect(Object.keys(data).sort()).toEqual([...KEPT].sort());
        expect(data.brand).toMatchObject({ companyName: 'Acme', legalName: 'Acme Inspections LLC', defaultLocale: 'de-DE', dateFormat: 'eu', timeFormat: '24h' });
    });

    it('the raw text of the response contains no private note', async () => {
        const res = await buildApp().request(`/api/public/inspections/${INSP}/invoice?token=${encodeURIComponent(token)}`);
        expect(await res.text()).not.toContain('do not discount again');
    });

    it('a null invoice still answers 200 with null data', async () => {
        const app = new OpenAPIHono<HonoConfig>();
        app.use('*', async (c, next) => {
            (c as unknown as { env: Record<string, unknown> }).env = { DB: testD1.binding, JWT_SECRET: SECRET };
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
