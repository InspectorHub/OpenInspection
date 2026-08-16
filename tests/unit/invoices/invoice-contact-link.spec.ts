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

    // --- the inspection rung ------------------------------------------------
    //
    // The dashboard's "New invoice" dialog collects an inspection, a name and
    // an amount. No email, no contact. So the two rungs above cannot fire for
    // the product's own main invoice-creation path, and every invoice raised
    // through it had a null `contact_id` and could never reach QuickBooks —
    // while the inspection it was raised from named the client all along.
    describe('an invoice raised against an inspection', () => {
        const INSPECTION = 'inspection-0000-0000-000000000001';
        const ROLE_CLIENT = 'role-client-0000-000000000001';
        const ROLE_AGENT  = 'role-agent-0000-0000000000002';

        beforeEach(async () => {
            await db.insert(schema.contactRoleProfiles).values([
                { id: ROLE_CLIENT, tenantId: TENANT, key: 'client', label: 'Client',
                  kind: 'client', isSystem: true, sortOrder: 0, active: true,
                  createdAt: T0, updatedAt: T0 },
                { id: ROLE_AGENT, tenantId: TENANT, key: 'buyer_agent', label: "Buyer's Agent",
                  kind: 'agent', isSystem: true, sortOrder: 1, active: true,
                  createdAt: T0, updatedAt: T0 },
            ] as never);
            await db.insert(schema.inspections).values({
                id: INSPECTION, tenantId: TENANT, propertyAddress: '742 Evergreen Terrace',
                date: '2026-03-01', status: 'scheduled', createdAt: T0,
            } as never);
        });

        const link = (contactId: string, roleProfileId: string) =>
            db.insert(schema.inspectionPeople).values({
                id: `ip-${contactId}-${roleProfileId}`.slice(0, 36),
                tenantId: TENANT, inspectionId: INSPECTION, contactId, roleProfileId,
                createdAt: T0,
            } as never);

        it('bills that inspection\'s primary client when nothing else identifies one', async () => {
            await link(PAT, ROLE_CLIENT);
            const inv = await svc.createInvoice(TENANT, {
                ...base, inspectionId: INSPECTION, clientEmail: null,
            });
            expect(await contactIdOf(inv.id)).toBe(PAT);
        });

        it('does not bill an agent on the inspection', async () => {
            // Positive control for the rung's selectivity: an inspection with
            // people on it but no CLIENT must still leave the link empty rather
            // than invoice whoever happens to be attached. Without this, the
            // query could be joining on the wrong thing and the spec above
            // would still pass.
            await link(SAM, ROLE_AGENT);
            const inv = await svc.createInvoice(TENANT, {
                ...base, inspectionId: INSPECTION, clientEmail: null,
            });
            expect(await contactIdOf(inv.id)).toBeNull();
        });

        it('still prefers a contact the caller named', async () => {
            await link(PAT, ROLE_CLIENT);
            const inv = await svc.createInvoice(TENANT, {
                ...base, inspectionId: INSPECTION, contactId: SAM,
            });
            expect(await contactIdOf(inv.id)).toBe(SAM);
        });
    });
});
