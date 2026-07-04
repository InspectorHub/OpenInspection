import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InspectionService } from '../../../server/services/inspection.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-000000000001';
const SLUG = 'acme';

describe('Issue #111 — InspectionService.getInspectionHub', () => {
    let svc: InspectionService;
    let testDb: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        await setupSchema(fixture.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        svc = new InspectionService({} as D1Database);

        await testDb.insert(schema.tenants).values([
            { id: TENANT, name: 'Acme', slug: SLUG, status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        ]);
    });

    it('returns every block fully populated for a complete inspection', async () => {
        await testDb.insert(schema.users).values({
            id: 'user-insp', tenantId: TENANT, email: 'inspector@acme.com',
            passwordHash: 'x', name: 'Sam Inspector', phone: '+15550009999',
            role: 'inspector', createdAt: new Date(),
        });
        await testDb.insert(schema.contacts).values([
            { id: 'agent-buyer-1',   tenantId: TENANT, type: 'agent', name: 'Bob Buyer-Agent',    email: 'bob@bba.com',  phone: '+15550001111', createdAt: new Date() },
            { id: 'agent-listing-1', tenantId: TENANT, type: 'agent', name: 'Lisa Listing-Agent', email: 'lisa@lla.com', phone: null,            createdAt: new Date() },
        ]);
        await testDb.insert(schema.templates).values({
            id: 'tpl-1', tenantId: TENANT, name: 'Standard', version: 1,
            schema: { sections: [] }, createdAt: new Date(),
        });
        await testDb.insert(schema.inspections).values({
            id: 'insp-full', tenantId: TENANT, inspectorId: 'user-insp',
            propertyAddress: '1 Main St', clientContactId: 'client-1',
            clientName: 'Jane Buyer', clientEmail: 'jane@example.com', clientPhone: '+15551234567',
            templateId: 'tpl-1', referredByAgentId: 'agent-buyer-1', sellingAgentId: 'agent-listing-1',
            coverPhotoId: 'cover-1', date: '2026-06-01', status: 'completed',
            paymentStatus: 'unpaid', price: 35000, paymentRequired: true, agreementRequired: true,
            createdAt: new Date(),
        });
        // Two service lines.
        await testDb.insert(schema.services).values([
            { id: 'svc-1', tenantId: TENANT, name: 'Home Inspection', price: 30000, createdAt: new Date() },
            { id: 'svc-2', tenantId: TENANT, name: 'Radon Test',      price: 5000,  createdAt: new Date() },
        ]);
        await testDb.insert(schema.inspectionServices).values([
            { id: 'is-1', tenantId: TENANT, inspectionId: 'insp-full', serviceId: 'svc-1', nameSnapshot: 'Home Inspection', priceSnapshot: 30000 },
            { id: 'is-2', tenantId: TENANT, inspectionId: 'insp-full', serviceId: 'svc-2', nameSnapshot: 'Radon Test',      priceSnapshot: 5000, priceOverride: 4500 },
        ]);
        // Tenant agreement templates (for a send-agreement dropdown).
        await testDb.insert(schema.agreements).values([
            { id: 'agr-1', tenantId: TENANT, name: 'Standard Agreement', content: '...', version: 1, createdAt: new Date() },
        ]);
        // Two agreement requests — newest first ordering must surface.
        await testDb.insert(schema.agreementRequests).values([
            { id: 'ar-old', tenantId: TENANT, inspectionId: 'insp-full', agreementId: 'agr-1', clientEmail: 'jane@example.com', token: 'tok-old', status: 'sent',   createdAt: new Date(1000) },
            { id: 'ar-new', tenantId: TENANT, inspectionId: 'insp-full', agreementId: 'agr-1', clientEmail: 'jane@example.com', token: 'tok-new', status: 'signed', signedAt: new Date(5000), createdAt: new Date(2000) },
        ]);
        // An invoice.
        await testDb.insert(schema.invoices).values({
            id: 'inv-1', tenantId: TENANT, inspectionId: 'insp-full',
            clientName: 'Jane Buyer', amountCents: 35000, lineItems: [],
            sentAt: new Date(3000), createdAt: new Date(3000),
        });

        const hub = await svc.getInspectionHub('insp-full', TENANT, SLUG);
        expect(hub).not.toBeNull();
        if (!hub) throw new Error('unreachable');

        // inspection block
        expect(hub.inspection).toMatchObject({
            id: 'insp-full', propertyAddress: '1 Main St', clientName: 'Jane Buyer',
            clientEmail: 'jane@example.com', clientPhone: '+15551234567', clientContactId: 'client-1',
            status: 'completed', inspectorId: 'user-insp', templateId: 'tpl-1', price: 35000,
            paymentStatus: 'unpaid', paymentRequired: true, agreementRequired: true,
            coverPhoto: 'cover-1', referredByAgentId: 'agent-buyer-1', sellingAgentId: 'agent-listing-1',
        });
        expect(hub.tenantSlug).toBe(SLUG);

        // people block (reuses getPeopleCard shape)
        expect(hub.people.inspector).toMatchObject({ name: 'Sam Inspector', email: 'inspector@acme.com' });
        expect(hub.people.client).toMatchObject({ name: 'Jane Buyer' });
        expect(hub.people.buyerAgents).toHaveLength(1);
        expect(hub.people.listingAgents).toHaveLength(1);

        // services block
        expect(hub.services).toHaveLength(2);
        expect(hub.services.map(s => s.name).sort()).toEqual(['Home Inspection', 'Radon Test']);
        const radon = hub.services.find(s => s.name === 'Radon Test');
        expect(radon?.priceCents).toBe(4500); // override beats snapshot

        // agreements (templates) block
        expect(hub.agreements).toEqual([{ id: 'agr-1', name: 'Standard Agreement' }]);

        // agreementRequests — newest first
        expect(hub.agreementRequests.map(r => r.id)).toEqual(['ar-new', 'ar-old']);
        expect(hub.agreementRequests[0]).toMatchObject({ status: 'signed', clientEmail: 'jane@example.com' });
        expect(hub.agreementRequests[0]?.signedAt).not.toBeNull();

        // invoice block
        expect(hub.invoice).toMatchObject({ id: 'inv-1', status: 'sent', amountCents: 35000 });
        expect(hub.invoice?.sentAt).not.toBeNull();
        expect(hub.invoice?.paidAt).toBeNull();

        // publishReadiness — reuses the existing service method
        expect(typeof hub.publishReadiness.ready).toBe('boolean');
        expect(typeof hub.publishReadiness.blockingCount).toBe('number');
    });

    it('returns null for an unknown id', async () => {
        const hub = await svc.getInspectionHub('does-not-exist', TENANT, SLUG);
        expect(hub).toBeNull();
    });

    it('returns null for a cross-tenant id', async () => {
        const OTHER = '00000000-0000-0000-0000-0000000000ff';
        await testDb.insert(schema.tenants).values({
            id: OTHER, name: 'Other', slug: 'other', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await testDb.insert(schema.inspections).values({
            id: 'insp-other', tenantId: OTHER, propertyAddress: 'X',
            clientName: null, clientEmail: null, clientPhone: null,
            date: '2026-06-01', status: 'requested', paymentStatus: 'unpaid',
            price: 0, paymentRequired: false, agreementRequired: false, createdAt: new Date(),
        });

        const hub = await svc.getInspectionHub('insp-other', TENANT, SLUG);
        expect(hub).toBeNull();
    });

    it('returns null invoice and empty agreementRequests when none exist', async () => {
        await testDb.insert(schema.inspections).values({
            id: 'insp-bare', tenantId: TENANT, propertyAddress: '1 Main St',
            clientName: 'Jane', clientEmail: null, clientPhone: null,
            date: '2026-06-01', status: 'requested', paymentStatus: 'unpaid',
            price: 0, paymentRequired: false, agreementRequired: false, createdAt: new Date(),
        });

        const hub = await svc.getInspectionHub('insp-bare', TENANT, SLUG);
        expect(hub).not.toBeNull();
        if (!hub) throw new Error('unreachable');
        expect(hub.invoice).toBeNull();
        expect(hub.agreementRequests).toEqual([]);
        expect(hub.services).toEqual([]);
        expect(hub.agreements).toEqual([]);
        expect(hub.people.client).toMatchObject({ name: 'Jane' });
    });
});
