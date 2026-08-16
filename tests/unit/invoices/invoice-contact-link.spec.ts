/**
 * A new invoice records WHO it bills, as a contact row.
 *
 * `invoices.contact_id` existed, indexed, from the day the table did, and no
 * write path ever set it — `createInvoice` is the only insert and it simply
 * left the column out. Exactly one consumer read it: the QuickBooks push, where
 * a null becomes a missing `CustomerRef`, which QuickBooks refuses outright
 * because CustomerRef is required on an Invoice. So every invoice this product
 * ever tried to push was rejected, and the rejection recorded itself as the
 * four-character string `QBO 400`.
 *
 * The QBO suite could not see it. Its fixtures INSERT the invoice row directly
 * and supply `contactId` themselves, so every test ran against data production
 * never produces — the same shape as the PUT defect one layer down, where the
 * mocks asserted the verb the implementation used.
 *
 * These specs therefore go through `createInvoice`. A test that writes the row
 * itself cannot fail for this reason, which is precisely how the defect lived.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InvoiceService } from '../../../server/services/invoice.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

const TENANT = '00000000-0000-0000-0000-0000000000d1';
const OTHER_TENANT = '00000000-0000-0000-0000-0000000000d2';
const PAT = 'contact-pat-0000-0000-000000000001';
const SAM = 'contact-sam-0000-0000-000000000002';
const T0 = new Date('2026-03-01T10:00:00Z');

describe('InvoiceService — the invoice knows which contact it bills', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let svc: InvoiceService;

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        await setupSchema(fix.sqlite);
        const { drizzle } = await import('drizzle-orm/d1');
        (drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
        svc = new InvoiceService({} as D1Database);

        for (const id of [TENANT, OTHER_TENANT]) {
            await db.insert(schema.tenants).values({
                id, slug: `t-${id.slice(-2)}`, status: 'active',
                deploymentMode: 'shared', tier: 'free', createdAt: T0,
            });
        }
        await db.insert(schema.contacts).values([
            { id: PAT, tenantId: TENANT, type: 'client', name: 'Pat Client', email: 'pat@example.com', createdAt: T0 },
            { id: SAM, tenantId: TENANT, type: 'client', name: 'Sam Client', email: 'sam@example.com', createdAt: T0 },
        ] as never);
    });

    const contactIdOf = async (id: string) =>
        (await db.select({ contactId: schema.invoices.contactId })
            .from(schema.invoices).where(eq(schema.invoices.id, id)).get())?.contactId ?? null;

    const base = { clientName: 'Pat Client', amountCents: 45000, lineItems: [] };

    it('stores the contact the caller named', async () => {
        const inv = await svc.createInvoice(TENANT, { ...base, contactId: PAT });
        expect(await contactIdOf(inv.id)).toBe(PAT);
    });

    it('resolves the contact from the client email when none was named', async () => {
        const inv = await svc.createInvoice(TENANT, { ...base, clientEmail: 'pat@example.com' });
        expect(await contactIdOf(inv.id)).toBe(PAT);
    });

    it('prefers the named contact over the email, which may be a typo', async () => {
        const inv = await svc.createInvoice(TENANT, {
            ...base, contactId: SAM, clientEmail: 'pat@example.com',
        });
        expect(await contactIdOf(inv.id)).toBe(SAM);
    });

    it('leaves the link empty rather than guessing from the name alone', async () => {
        // Two clients called "Pat Client" are two people. Billing the wrong one
        // is worse than not linking, so a name is never a match key.
        const inv = await svc.createInvoice(TENANT, { ...base, clientEmail: null });
        expect(await contactIdOf(inv.id)).toBeNull();
    });

    it('never resolves across tenants', async () => {
        const inv = await svc.createInvoice(OTHER_TENANT, { ...base, clientEmail: 'pat@example.com' });
        expect(await contactIdOf(inv.id)).toBeNull();
    });
});
