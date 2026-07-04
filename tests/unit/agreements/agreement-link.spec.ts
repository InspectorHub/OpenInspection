import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

/**
 * Track I-a Task 8 — agreement-request email link choice.
 *
 * shouldUseCheckoutLink() decides whether the email points the recipient at the
 * combined Sign & pay page (/checkout/...) vs the standalone sign page
 * (/agreements/sign/...). The combined link is used iff the bound inspection
 * requires payment AND has an outstanding (unpaid) invoice.
 *
 * Mirrors checkout-public.spec.ts: drizzle-orm/d1 is mocked to the test DB.
 */

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

// eslint-disable-next-line import/order
import { shouldUseCheckoutLink } from '../../../server/lib/agreement-link';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const INSP_ID = '00000000-0000-0000-0000-000000000010';
const INV_ID = '00000000-0000-0000-0000-000000000030';
const FAKE_DB = {} as unknown as D1Database;

describe('shouldUseCheckoutLink (Track I-a Task 8)', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: any;

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db as BetterSQLite3Database<typeof schema>;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);
        (mockDrizzle as any).mockReturnValue(db);
        await db.insert(schema.tenants).values({
            id: TENANT_ID, name: 'Acme', slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', maxUsers: 5, createdAt: new Date(),
        } as any);
    });

    afterEach(() => sqlite.close());

    async function seedInspection(over: Partial<typeof schema.inspections.$inferInsert> = {}) {
        await db.insert(schema.inspections).values({
            id: INSP_ID, tenantId: TENANT_ID, propertyAddress: '1 Main St', date: '2026-06-01',
            status: 'requested', paymentStatus: 'unpaid', paymentRequired: true, createdAt: new Date(),
            ...over,
        } as any);
    }

    async function seedInvoice(over: Partial<typeof schema.invoices.$inferInsert> = {}) {
        await db.insert(schema.invoices).values({
            id: INV_ID, tenantId: TENANT_ID, inspectionId: INSP_ID, amountCents: 45000,
            lineItems: [], createdAt: new Date(), ...over,
        } as any);
    }

    it('false when no inspection is bound', async () => {
        expect(await shouldUseCheckoutLink(FAKE_DB, TENANT_ID, null)).toBe(false);
        expect(await shouldUseCheckoutLink(FAKE_DB, TENANT_ID, undefined)).toBe(false);
    });

    it('false when the inspection does not require payment', async () => {
        await seedInspection({ paymentRequired: false });
        await seedInvoice();
        expect(await shouldUseCheckoutLink(FAKE_DB, TENANT_ID, INSP_ID)).toBe(false);
    });

    it('false when payment required but there is no invoice', async () => {
        await seedInspection({ paymentRequired: true });
        expect(await shouldUseCheckoutLink(FAKE_DB, TENANT_ID, INSP_ID)).toBe(false);
    });

    it('false when the invoice is already paid', async () => {
        await seedInspection({ paymentRequired: true });
        await seedInvoice({ paidAt: new Date() });
        expect(await shouldUseCheckoutLink(FAKE_DB, TENANT_ID, INSP_ID)).toBe(false);
    });

    it('true when the invoice is only partially paid (balance remains)', async () => {
        await seedInspection({ paymentRequired: true });
        await seedInvoice({ paidAt: null, partialPaidAt: new Date() });
        expect(await shouldUseCheckoutLink(FAKE_DB, TENANT_ID, INSP_ID)).toBe(true);
    });

    it('true when payment required AND an unpaid invoice exists', async () => {
        await seedInspection({ paymentRequired: true });
        await seedInvoice({ paidAt: null });
        expect(await shouldUseCheckoutLink(FAKE_DB, TENANT_ID, INSP_ID)).toBe(true);
    });

    it('scopes to the tenant (cross-tenant inspection id → false)', async () => {
        await seedInspection({ paymentRequired: true });
        await seedInvoice({ paidAt: null });
        expect(await shouldUseCheckoutLink(FAKE_DB, 'other-tenant', INSP_ID)).toBe(false);
    });
});
