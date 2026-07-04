import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ContactService } from '../../../server/services/contact.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTHER = '00000000-0000-0000-0000-0000000000ff';

describe('IA-18 — ContactService.getContactDetail', () => {
    let svc: ContactService;
    let testDb: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        await setupSchema(fixture.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        svc = new ContactService({} as D1Database);

        await testDb.insert(schema.tenants).values([
            { id: TENANT, name: 'Acme', slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
            { id: OTHER, name: 'Other', slug: 'other', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        ]);
    });

    it('client: history via clientContactId AND legacy email-only row, deduped, date desc', async () => {
        await testDb.insert(schema.contacts).values({
            id: 'client-1', tenantId: TENANT, type: 'client', name: 'Jane Buyer',
            email: 'jane@example.com', phone: '+15551234567', createdAt: new Date(),
        });
        // 1) Linked via clientContactId (no email match needed). Newest date.
        // 2) Legacy row: NO clientContactId, matched only by clientEmail. Older date.
        // 3) A row matched by BOTH clientContactId and email — must appear ONCE (dedup).
        await testDb.insert(schema.inspections).values([
            { id: 'insp-linked', tenantId: TENANT, propertyAddress: '1 Linked St', clientContactId: 'client-1',
              clientName: 'Jane Buyer', clientEmail: null, clientPhone: null,
              date: '2026-06-03', status: 'completed', paymentStatus: 'paid', price: 30000,
              paymentRequired: false, agreementRequired: false, createdAt: new Date() },
            { id: 'insp-legacy', tenantId: TENANT, propertyAddress: '2 Legacy Ave', clientContactId: null,
              clientName: 'Jane Buyer', clientEmail: 'jane@example.com', clientPhone: null,
              date: '2026-06-01', status: 'completed', paymentStatus: 'unpaid', price: 25000,
              paymentRequired: false, agreementRequired: false, createdAt: new Date() },
            { id: 'insp-both', tenantId: TENANT, propertyAddress: '3 Both Rd', clientContactId: 'client-1',
              clientName: 'Jane Buyer', clientEmail: 'jane@example.com', clientPhone: null,
              date: '2026-06-02', status: 'completed', paymentStatus: 'unpaid', price: 20000,
              paymentRequired: false, agreementRequired: false, createdAt: new Date() },
        ]);

        const detail = await svc.getContactDetail('client-1', TENANT);
        expect(detail).not.toBeNull();
        if (!detail) throw new Error('unreachable');

        expect(detail.contact).toMatchObject({ id: 'client-1', type: 'client', name: 'Jane Buyer' });
        // Three distinct inspections, deduped (insp-both not double-counted).
        expect(detail.inspections.map(i => i.id)).toEqual(['insp-linked', 'insp-both', 'insp-legacy']);
        expect(detail.stats.inspectionCount).toBe(3);
    });

    it('agent: history via referredByAgentId + legacy sellingAgentId row, deduped', async () => {
        await testDb.insert(schema.contacts).values({
            id: 'agent-1', tenantId: TENANT, type: 'agent', name: 'Bob Agent',
            email: 'bob@bba.com', phone: null, agency: 'BBA Realty', createdAt: new Date(),
        });
        await testDb.insert(schema.inspections).values([
            { id: 'insp-referred', tenantId: TENANT, propertyAddress: '1 Referred St', referredByAgentId: 'agent-1',
              clientName: null, clientEmail: null, clientPhone: null,
              date: '2026-06-05', status: 'completed', paymentStatus: 'paid', price: 30000,
              paymentRequired: false, agreementRequired: false, createdAt: new Date() },
            { id: 'insp-selling', tenantId: TENANT, propertyAddress: '2 Selling Ave', sellingAgentId: 'agent-1',
              clientName: null, clientEmail: null, clientPhone: null,
              date: '2026-06-04', status: 'completed', paymentStatus: 'unpaid', price: 25000,
              paymentRequired: false, agreementRequired: false, createdAt: new Date() },
            // Both fields point at the agent — appears once.
            { id: 'insp-agent-both', tenantId: TENANT, propertyAddress: '3 Both Rd', referredByAgentId: 'agent-1', sellingAgentId: 'agent-1',
              clientName: null, clientEmail: null, clientPhone: null,
              date: '2026-06-06', status: 'completed', paymentStatus: 'unpaid', price: 20000,
              paymentRequired: false, agreementRequired: false, createdAt: new Date() },
        ]);

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
            { id: 'insp-paid', tenantId: TENANT, propertyAddress: '1 Paid St', clientContactId: 'client-rev',
              clientName: 'Pay Client', clientEmail: null, clientPhone: null,
              date: '2026-06-02', status: 'completed', paymentStatus: 'paid', price: 30000,
              paymentRequired: false, agreementRequired: false, createdAt: new Date() },
            { id: 'insp-unpaid', tenantId: TENANT, propertyAddress: '2 Unpaid Ave', clientContactId: 'client-rev',
              clientName: 'Pay Client', clientEmail: null, clientPhone: null,
              date: '2026-06-01', status: 'completed', paymentStatus: 'unpaid', price: 25000,
              paymentRequired: false, agreementRequired: false, createdAt: new Date() },
        ]);
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

    it('archived contact still returns detail with history', async () => {
        await testDb.insert(schema.contacts).values({
            id: 'client-arch', tenantId: TENANT, type: 'client', name: 'Archived Client',
            email: 'arch@example.com', createdAt: new Date(), archivedAt: new Date(),
        });
        await testDb.insert(schema.inspections).values({
            id: 'insp-arch', tenantId: TENANT, propertyAddress: '1 Arch St', clientContactId: 'client-arch',
            clientName: 'Archived Client', clientEmail: null, clientPhone: null,
            date: '2026-06-01', status: 'completed', paymentStatus: 'unpaid', price: 10000,
            paymentRequired: false, agreementRequired: false, createdAt: new Date(),
        });

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
