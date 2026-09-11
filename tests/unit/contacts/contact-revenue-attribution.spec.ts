/**
 * F67 — one $450 payment was reported as TOTAL REVENUE on TWO contact records.
 *
 * | Contact       | Role   | INSPECTIONS | TOTAL REVENUE |
 * |---------------|--------|-------------|---------------|
 * | Marge Simpson | client | 2           | $450.00       |
 * | Ned Flanders  | agent  | 1           | $450.00       |
 *
 * The whole database held one invoice, $450, paid. `totalRevenueCents` was
 * "paid invoices on any inspection this contact is attached to", and attachment
 * is an `inspection_people` row — which names the client, the co-client, the
 * buyer's agent, the listing agent, the attorney and anyone else on the job. So
 * the per-contact figure an operator naturally ADDS UP reported $900 of revenue
 * from a single $450 payment, and the more people an inspection had, the further
 * out the total went.
 *
 * The fix keys revenue on `invoices.contact_id` — the billed party, set at
 * creation by InvoiceService.resolveContactId. One invoice has one billed
 * contact, so it can land on exactly one record.
 *
 * The agent's $450 is not deleted, because "a payment on a job you referred" is
 * a real fact an inspector wants. It moves to `billedToOthersCents`, under a name
 * that says whose money it is. The defect was never the number — it was two
 * different facts sharing one word.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ContactService } from '../../../server/services/contact.service';
import { PeopleService } from '../../../server/services/people.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import { asD1Db } from '../helpers/test-db';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-000000000001';
const roleProfileId = (key: string) => `crp_${TENANT}_${key}`;

describe('F67 — per-contact revenue is attributed to the billed party only', () => {
    let svc: ContactService;
    let people: PeopleService;
    let testDb: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        await setupSchema(fixture.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        svc = new ContactService({} as D1Database);
        people = new PeopleService({ DB: {} as D1Database });

        await testDb.insert(schema.tenants).values({
            id: TENANT, slug: 'acme', status: 'active', deploymentMode: 'shared',
            tier: 'free', createdAt: new Date(),
        });
        await seedRoleProfiles(asD1Db(testDb), TENANT, new Date(1));

        // The walkthrough's own data: one inspection, one client, one buyer's
        // agent, one paid $450 invoice billed to the client.
        await testDb.insert(schema.contacts).values([
            { id: 'marge', tenantId: TENANT, type: 'client', name: 'Marge Simpson',
              email: 'marge@example.com', createdAt: new Date() },
            { id: 'ned', tenantId: TENANT, type: 'agent', name: 'Ned Flanders',
              email: 'ned@example.com', agency: 'Flanders Realty', createdAt: new Date() },
        ]);
        await testDb.insert(schema.inspections).values({
            id: 'insp-evergreen', tenantId: TENANT, propertyAddress: '742 Evergreen Terrace',
            date: '2026-09-10', status: 'completed', paymentStatus: 'paid', price: 45000,
            paymentRequired: false, agreementRequired: false, createdAt: new Date(),
        });
        await people.addPerson(TENANT, 'insp-evergreen', 'marge', roleProfileId('client'));
        await people.addPerson(TENANT, 'insp-evergreen', 'ned', roleProfileId('buyer_agent'));
        await testDb.insert(schema.invoices).values({
            id: 'inv-450', tenantId: TENANT, inspectionId: 'insp-evergreen',
            contactId: 'marge', amountCents: 45000, lineItems: [],
            paidAt: new Date(5000), createdAt: new Date(1000),
        });
    });

    it('credits the $450 to the contact it was billed to', async () => {
        const detail = await svc.getContactDetail('marge', TENANT);
        if (!detail) throw new Error('unreachable');
        expect(detail.stats.totalRevenueCents).toBe(45000);
        // Nothing on her record was billed elsewhere, so the second tile is absent.
        expect(detail.stats.billedToOthersCents).toBe(0);
    });

    it('does not credit the same $450 to the agent standing on the same job', async () => {
        const detail = await svc.getContactDetail('ned', TENANT);
        if (!detail) throw new Error('unreachable');
        expect(detail.stats.totalRevenueCents).toBe(0);
        // The inspection is still his — only the money is not.
        expect(detail.stats.inspectionCount).toBe(1);
    });

    it('reports the agent the money under a name that is true of it', async () => {
        const detail = await svc.getContactDetail('ned', TENANT);
        if (!detail) throw new Error('unreachable');
        expect(detail.stats.billedToOthersCents).toBe(45000);
    });

    /**
     * THE ASSERTION THE WHOLE FINDING IS ABOUT. Either figure being right on its
     * own is not the property that was broken; what was broken is that adding the
     * per-contact revenue across the database produced more money than the
     * database contains. One paid invoice, so one $450, however many people were
     * on the job.
     */
    it('sums across every contact to exactly the money received, once', async () => {
        const everyContact = ['marge', 'ned'];
        let sum = 0;
        for (const id of everyContact) {
            const d = await svc.getContactDetail(id, TENANT);
            if (!d) throw new Error('unreachable');
            sum += d.stats.totalRevenueCents;
        }
        expect(sum).toBe(45000);
    });

    /**
     * POSITIVE CONTROL, and it is the one that matters: an implementation that
     * returned 0 revenue for everybody would pass all four assertions above. A
     * contact billed on two jobs must accumulate both.
     */
    it('still adds up multiple invoices billed to the same contact', async () => {
        await testDb.insert(schema.inspections).values({
            id: 'insp-second', tenantId: TENANT, propertyAddress: '1 Second St',
            date: '2026-09-11', status: 'completed', paymentStatus: 'paid', price: 20000,
            paymentRequired: false, agreementRequired: false, createdAt: new Date(),
        });
        await people.addPerson(TENANT, 'insp-second', 'marge', roleProfileId('client'));
        await testDb.insert(schema.invoices).values({
            id: 'inv-200', tenantId: TENANT, inspectionId: 'insp-second',
            contactId: 'marge', amountCents: 20000, lineItems: [],
            paidAt: new Date(6000), createdAt: new Date(2000),
        });

        const detail = await svc.getContactDetail('marge', TENANT);
        if (!detail) throw new Error('unreachable');
        expect(detail.stats.totalRevenueCents).toBe(65000);
        expect(detail.stats.inspectionCount).toBe(2);
    });

    /**
     * SECOND CONTROL: the split is on the BILLED PARTY, not on the contact's type.
     * An agent who is billed directly — their own pre-purchase inspection, a
     * listing package they pay for — has real revenue, and a rule written on
     * `contacts.type` or on the role kind would zero it.
     */
    it('credits an agent who was billed the invoice themselves', async () => {
        await testDb.insert(schema.inspections).values({
            id: 'insp-ned-own', tenantId: TENANT, propertyAddress: '2 Listing Ave',
            date: '2026-09-12', status: 'completed', paymentStatus: 'paid', price: 30000,
            paymentRequired: false, agreementRequired: false, createdAt: new Date(),
        });
        await people.addPerson(TENANT, 'insp-ned-own', 'ned', roleProfileId('client'));
        await testDb.insert(schema.invoices).values({
            id: 'inv-300', tenantId: TENANT, inspectionId: 'insp-ned-own',
            contactId: 'ned', amountCents: 30000, lineItems: [],
            paidAt: new Date(7000), createdAt: new Date(3000),
        });

        const detail = await svc.getContactDetail('ned', TENANT);
        if (!detail) throw new Error('unreachable');
        expect(detail.stats.totalRevenueCents).toBe(30000);
        // And the referred job's money is still reported separately.
        expect(detail.stats.billedToOthersCents).toBe(45000);
    });

    /** An unpaid invoice is a hope, not revenue — on either side of the split. */
    it('counts neither figure until the invoice is paid', async () => {
        await testDb.update(schema.invoices).set({ paidAt: null });

        const marge = await svc.getContactDetail('marge', TENANT);
        const ned = await svc.getContactDetail('ned', TENANT);
        if (!marge || !ned) throw new Error('unreachable');
        expect(marge.stats.totalRevenueCents).toBe(0);
        expect(ned.stats.billedToOthersCents).toBe(0);
    });
});
