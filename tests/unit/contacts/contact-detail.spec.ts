/**
 * Task 9c-X2 (people-role-profiles) — ContactService.getContactDetail's
 * inspection history must be sourced from an inspection_people join (any role
 * on the contact), not the legacy dual-path linkage predicate
 * (referredByAgentId/sellingAgentId for agents, clientContactId/clientEmail
 * for clients — frozen cache, dropped Task 13). Seeds ONLY inspection_people
 * rows (legacy columns left unset), so this fails against the old
 * linkage-predicate implementation.
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
const OTHER = '00000000-0000-0000-0000-0000000000ff';

const roleProfileId = (key: string) => `crp_${TENANT}_${key}`;

describe('IA-18 — ContactService.getContactDetail', () => {
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

        await testDb.insert(schema.tenants).values([
            { id: TENANT, name: 'Acme', slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
            { id: OTHER, name: 'Other', slug: 'other', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        ]);
        await seedRoleProfiles(asD1Db(testDb), TENANT, new Date(1));
    });

    it('client: history via inspection_people (client role), deduped, date desc', async () => {
        await testDb.insert(schema.contacts).values({
            id: 'client-1', tenantId: TENANT, type: 'client', name: 'Jane Buyer',
            email: 'jane@example.com', phone: '+15551234567', createdAt: new Date(),
        });
        // 1) client role. Newest date.
        // 2) client role (equivalent of the old "legacy email-only" case — the
        //    contact holds a role, no email needed for linkage anymore). Older date.
        // 3) A row where the contact holds BOTH client AND co_client roles —
        //    must appear ONCE (dedup by inspection id).
        await testDb.insert(schema.inspections).values([
            { id: 'insp-linked', tenantId: TENANT, propertyAddress: '1 Linked St',
              date: '2026-06-03', status: 'completed', paymentStatus: 'paid', price: 30000,
              paymentRequired: false, agreementRequired: false, createdAt: new Date() },
            { id: 'insp-legacy', tenantId: TENANT, propertyAddress: '2 Legacy Ave',
              date: '2026-06-01', status: 'completed', paymentStatus: 'unpaid', price: 25000,
              paymentRequired: false, agreementRequired: false, createdAt: new Date() },
            { id: 'insp-both', tenantId: TENANT, propertyAddress: '3 Both Rd',
              date: '2026-06-02', status: 'completed', paymentStatus: 'unpaid', price: 20000,
              paymentRequired: false, agreementRequired: false, createdAt: new Date() },
        ]);
        await people.addPerson(TENANT, 'insp-linked', 'client-1', roleProfileId('client'));
        await people.addPerson(TENANT, 'insp-legacy', 'client-1', roleProfileId('client'));
        await people.addPerson(TENANT, 'insp-both', 'client-1', roleProfileId('client'));
        await people.addPerson(TENANT, 'insp-both', 'client-1', roleProfileId('co_client'));

        const detail = await svc.getContactDetail('client-1', TENANT);
        expect(detail).not.toBeNull();
        if (!detail) throw new Error('unreachable');

        expect(detail.contact).toMatchObject({ id: 'client-1', type: 'client', name: 'Jane Buyer' });
        // Three distinct inspections, deduped (insp-both not double-counted
        // despite holding two roles for this contact).
        expect(detail.inspections.map(i => i.id)).toEqual(['insp-linked', 'insp-both', 'insp-legacy']);
        expect(detail.stats.inspectionCount).toBe(3);
    });

    it('agent: history via inspection_people (buyer_agent + listing_agent roles), deduped', async () => {
        await testDb.insert(schema.contacts).values({
            id: 'agent-1', tenantId: TENANT, type: 'agent', name: 'Bob Agent',
            email: 'bob@bba.com', phone: null, agency: 'BBA Realty', createdAt: new Date(),
        });
        await testDb.insert(schema.inspections).values([
            { id: 'insp-referred', tenantId: TENANT, propertyAddress: '1 Referred St',
              date: '2026-06-05', status: 'completed', paymentStatus: 'paid', price: 30000,
              paymentRequired: false, agreementRequired: false, createdAt: new Date() },
            { id: 'insp-selling', tenantId: TENANT, propertyAddress: '2 Selling Ave',
              date: '2026-06-04', status: 'completed', paymentStatus: 'unpaid', price: 25000,
              paymentRequired: false, agreementRequired: false, createdAt: new Date() },
            // Both roles point at the agent — appears once.
            { id: 'insp-agent-both', tenantId: TENANT, propertyAddress: '3 Both Rd',
              date: '2026-06-06', status: 'completed', paymentStatus: 'unpaid', price: 20000,
              paymentRequired: false, agreementRequired: false, createdAt: new Date() },
        ]);
        await people.addPerson(TENANT, 'insp-referred', 'agent-1', roleProfileId('buyer_agent'));
        await people.addPerson(TENANT, 'insp-selling', 'agent-1', roleProfileId('listing_agent'));
        await people.addPerson(TENANT, 'insp-agent-both', 'agent-1', roleProfileId('buyer_agent'));
        await people.addPerson(TENANT, 'insp-agent-both', 'agent-1', roleProfileId('listing_agent'));

        const detail = await svc.getContactDetail('agent-1', TENANT);
        expect(detail).not.toBeNull();
        if (!detail) throw new Error('unreachable');

        expect(detail.contact).toMatchObject({ id: 'agent-1', type: 'agent', agency: 'BBA Realty' });
        expect(detail.inspections.map(i => i.id)).toEqual(['insp-agent-both', 'insp-referred', 'insp-selling']);
        expect(detail.stats.inspectionCount).toBe(3);
    });

    it('revenue: counts only PAID invoices; inspectionCount counts both inspections', async () => {
        await testDb.insert(schema.contacts).values({
            id: 'client-rev', tenantId: TENANT, type: 'client', name: 'Pay Client',
            email: 'pay@example.com', createdAt: new Date(),
        });
        await testDb.insert(schema.inspections).values([
            { id: 'insp-paid', tenantId: TENANT, propertyAddress: '1 Paid St',
              date: '2026-06-02', status: 'completed', paymentStatus: 'paid', price: 30000,
              paymentRequired: false, agreementRequired: false, createdAt: new Date() },
            { id: 'insp-unpaid', tenantId: TENANT, propertyAddress: '2 Unpaid Ave',
              date: '2026-06-01', status: 'completed', paymentStatus: 'unpaid', price: 25000,
              paymentRequired: false, agreementRequired: false, createdAt: new Date() },
        ]);
        await people.addPerson(TENANT, 'insp-paid', 'client-rev', roleProfileId('client'));
        await people.addPerson(TENANT, 'insp-unpaid', 'client-rev', roleProfileId('client'));
        await testDb.insert(schema.invoices).values([
            { id: 'inv-paid', tenantId: TENANT, inspectionId: 'insp-paid', amountCents: 30000,
              lineItems: [], paidAt: new Date(5000), createdAt: new Date(1000) },
            { id: 'inv-unpaid', tenantId: TENANT, inspectionId: 'insp-unpaid', amountCents: 25000,
              lineItems: [], paidAt: null, createdAt: new Date(1000) },
        ]);

        const detail = await svc.getContactDetail('client-rev', TENANT);
        expect(detail).not.toBeNull();
        if (!detail) throw new Error('unreachable');

        expect(detail.stats.inspectionCount).toBe(2);
        expect(detail.stats.totalRevenueCents).toBe(30000); // only the paid invoice
    });

    it('per-row price follows the invoice, not the stale cache (P-4 tier 1)', async () => {
        // The bug this pins: the card read `inspections.price` — tier 3, a
        // denormalized cache — and rendered "$0.00 / Unpaid" directly beneath
        // its own "TOTAL REVENUE $450.00", computed from the paid invoice on
        // that same inspection. One card, two numbers, same money.
        await testDb.insert(schema.contacts).values({
            id: 'client-drift', tenantId: TENANT, type: 'client', name: 'Drift',
            email: 'drift@example.com', createdAt: new Date(),
        });
        await testDb.insert(schema.inspections).values([
            // Cache says zero; a PAID invoice says 45000.
            { id: 'insp-drift-paid', tenantId: TENANT, propertyAddress: '742 Evergreen',
              date: '2026-06-02', status: 'completed', paymentStatus: 'unpaid', price: 0,
              paymentRequired: false, agreementRequired: false, createdAt: new Date() },
            // Cache says zero; an UNPAID invoice still outranks it — tier 1 is
            // "an invoice exists", not "an invoice was paid".
            { id: 'insp-drift-unpaid', tenantId: TENANT, propertyAddress: '1 Lifecycle',
              date: '2026-06-01', status: 'completed', paymentStatus: 'unpaid', price: 0,
              paymentRequired: false, agreementRequired: false, createdAt: new Date() },
        ]);
        await people.addPerson(TENANT, 'insp-drift-paid', 'client-drift', roleProfileId('client'));
        await people.addPerson(TENANT, 'insp-drift-unpaid', 'client-drift', roleProfileId('client'));
        await testDb.insert(schema.invoices).values([
            { id: 'inv-drift-paid', tenantId: TENANT, inspectionId: 'insp-drift-paid',
              amountCents: 45000, lineItems: [], paidAt: new Date(5000), createdAt: new Date(1000) },
            { id: 'inv-drift-unpaid', tenantId: TENANT, inspectionId: 'insp-drift-unpaid',
              amountCents: 38000, lineItems: [], paidAt: null, createdAt: new Date(1000) },
        ]);

        const detail = await svc.getContactDetail('client-drift', TENANT);
        if (!detail) throw new Error('unreachable');

        const byId = Object.fromEntries(detail.inspections.map(i => [i.id, i.price]));
        expect(byId['insp-drift-paid']).toBe(45000);
        expect(byId['insp-drift-unpaid']).toBe(38000);

        // Revenue is unchanged by all this: still paid-only.
        expect(detail.stats.totalRevenueCents).toBe(45000);

        // And the status stops contradicting the amount beside it.
        const status = Object.fromEntries(detail.inspections.map(i => [i.id, i.paymentStatus]));
        expect(status['insp-drift-paid']).toBe('paid');
        expect(status['insp-drift-unpaid']).toBe('unpaid');
    });

    it('never demotes a partial payment to unpaid', async () => {
        // `partial` exists only on the inspection (markPartial writes it there),
        // so an unpaid invoice must not overwrite it. The derivation only ever
        // promotes to paid.
        await testDb.insert(schema.contacts).values({
            id: 'client-partial', tenantId: TENANT, type: 'client', name: 'Partial',
            email: 'partial@example.com', createdAt: new Date(),
        });
        await testDb.insert(schema.inspections).values({
            id: 'insp-partial', tenantId: TENANT, propertyAddress: '5 Half Rd',
            date: '2026-06-01', status: 'completed', paymentStatus: 'partial', price: 0,
            paymentRequired: false, agreementRequired: false, createdAt: new Date(),
        });
        await people.addPerson(TENANT, 'insp-partial', 'client-partial', roleProfileId('client'));
        await testDb.insert(schema.invoices).values({
            id: 'inv-partial', tenantId: TENANT, inspectionId: 'insp-partial', amountCents: 50000,
            lineItems: [], paidAt: null, createdAt: new Date(1000),
        });

        const detail = await svc.getContactDetail('client-partial', TENANT);
        if (!detail) throw new Error('unreachable');
        expect(detail.inspections[0].paymentStatus).toBe('partial');
        expect(detail.inspections[0].price).toBe(50000);
    });

    it('falls back to the cached price when no invoice exists', async () => {
        // Tier 3 is still a real tier. Reaching for the invoice must not zero
        // out an inspection that simply has not been invoiced yet.
        await testDb.insert(schema.contacts).values({
            id: 'client-nocache', tenantId: TENANT, type: 'client', name: 'NoInv',
            email: 'noinv@example.com', createdAt: new Date(),
        });
        await testDb.insert(schema.inspections).values({
            id: 'insp-noinv', tenantId: TENANT, propertyAddress: '9 Cache Ln',
            date: '2026-06-01', status: 'completed', paymentStatus: 'unpaid', price: 27500,
            paymentRequired: false, agreementRequired: false, createdAt: new Date(),
        });
        await people.addPerson(TENANT, 'insp-noinv', 'client-nocache', roleProfileId('client'));

        const detail = await svc.getContactDetail('client-nocache', TENANT);
        if (!detail) throw new Error('unreachable');
        expect(detail.inspections[0].price).toBe(27500);
    });

    it('a voided invoice does not become the price', async () => {
        // Voided means withdrawn. Letting it win tier 1 would show a number the
        // company has explicitly retracted.
        await testDb.insert(schema.contacts).values({
            id: 'client-void', tenantId: TENANT, type: 'client', name: 'Void',
            email: 'void@example.com', createdAt: new Date(),
        });
        await testDb.insert(schema.inspections).values({
            id: 'insp-void', tenantId: TENANT, propertyAddress: '3 Void Way',
            date: '2026-06-01', status: 'completed', paymentStatus: 'unpaid', price: 19900,
            paymentRequired: false, agreementRequired: false, createdAt: new Date(),
        });
        await people.addPerson(TENANT, 'insp-void', 'client-void', roleProfileId('client'));
        await testDb.insert(schema.invoices).values({
            id: 'inv-void', tenantId: TENANT, inspectionId: 'insp-void', amountCents: 99900,
            lineItems: [], paidAt: null, voidedAt: new Date(9000), createdAt: new Date(1000),
        });

        const detail = await svc.getContactDetail('client-void', TENANT);
        if (!detail) throw new Error('unreachable');
        expect(detail.inspections[0].price).toBe(19900);
    });

    it('archived contact still returns detail with history', async () => {
        await testDb.insert(schema.contacts).values({
            id: 'client-arch', tenantId: TENANT, type: 'client', name: 'Archived Client',
            email: 'arch@example.com', createdAt: new Date(), archivedAt: new Date(),
        });
        await testDb.insert(schema.inspections).values({
            id: 'insp-arch', tenantId: TENANT, propertyAddress: '1 Arch St',
            date: '2026-06-01', status: 'completed', paymentStatus: 'unpaid', price: 10000,
            paymentRequired: false, agreementRequired: false, createdAt: new Date(),
        });
        await people.addPerson(TENANT, 'insp-arch', 'client-arch', roleProfileId('client'));

        const detail = await svc.getContactDetail('client-arch', TENANT);
        expect(detail).not.toBeNull();
        if (!detail) throw new Error('unreachable');
        expect(detail.contact.archivedAt).not.toBeNull();
        expect(detail.inspections.map(i => i.id)).toEqual(['insp-arch']);
    });

    it('cross-tenant id and unknown id both return null', async () => {
        await testDb.insert(schema.contacts).values({
            id: 'foreign-1', tenantId: OTHER, type: 'client', name: 'Foreign',
            email: 'foreign@example.com', createdAt: new Date(),
        });

        expect(await svc.getContactDetail('foreign-1', TENANT)).toBeNull();
        expect(await svc.getContactDetail('does-not-exist', TENANT)).toBeNull();
    });
});
