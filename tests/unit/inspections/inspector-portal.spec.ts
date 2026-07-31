import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InspectionService } from '../../../server/services/inspection.service';
import { PeopleService } from '../../../server/services/people.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-000000000001';
const SLUG = 'acme';

// getInspectionHub's `people` block reuses getPeopleCard (Task 8), which now
// sources people from inspection_people (via PeopleService.listPeople), not
// the legacy inline/agent-id columns — tests below seed inspection_people
// rows alongside the legacy columns so those columns stay realistic without
// being what's actually read.
const roleProfileId = (tenantId: string, key: string) => `crp_${tenantId}_${key}`;

describe('Issue #111 — InspectionService.getInspectionHub', () => {
    let svc: InspectionService;
    let testDb: BetterSQLite3Database<typeof schema>;
    let people: PeopleService;

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        await setupSchema(fixture.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        svc = new InspectionService({} as D1Database);
        people = new PeopleService({ DB: {} as D1Database });

        await testDb.insert(schema.tenants).values([
            { id: TENANT, name: 'Acme', slug: SLUG, status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        ]);
        await seedRoleProfiles(testDb, TENANT, new Date(1));
    });

    it('returns every block fully populated for a complete inspection', async () => {
        await testDb.insert(schema.users).values({
            id: 'user-insp', tenantId: TENANT, email: 'inspector@acme.com',
            passwordHash: 'x', name: 'Sam Inspector', phone: '+15550009999',
            role: 'inspector', createdAt: new Date(),
        });
        await testDb.insert(schema.contacts).values([
            { id: 'client-1',        tenantId: TENANT, type: 'client', name: 'Jane Buyer',        email: 'jane@example.com', phone: '+15551234567', createdAt: new Date() },
            { id: 'agent-buyer-1',   tenantId: TENANT, type: 'agent', name: 'Bob Buyer-Agent',    email: 'bob@bba.com',  phone: '+15550001111', createdAt: new Date() },
            { id: 'agent-listing-1', tenantId: TENANT, type: 'agent', name: 'Lisa Listing-Agent', email: 'lisa@lla.com', phone: null,            createdAt: new Date() },
            // Task 9c — decoy contacts backing the deliberately-WRONG legacy
            // referredByAgentId/sellingAgentId column values below (sellingAgentId
            // carries a frozen legacy FK to contacts.id, so the decoy must be a
            // real row — just not the one inspection_people actually links).
            { id: 'stale-agent-buyer',   tenantId: TENANT, type: 'agent', name: 'Decoy Buyer-Agent',   email: 'decoy-buyer@example.com',   createdAt: new Date() },
            { id: 'stale-agent-listing', tenantId: TENANT, type: 'agent', name: 'Decoy Listing-Agent', email: 'decoy-listing@example.com', createdAt: new Date() },
        ]);
        await testDb.insert(schema.templates).values({
            id: 'tpl-1', tenantId: TENANT, name: 'Standard', version: 1,
            schema: { sections: [] }, createdAt: new Date(),
        });
        await testDb.insert(schema.inspections).values({
            id: 'insp-full', tenantId: TENANT, inspectorId: 'user-insp',
            propertyAddress: '1 Main St',
            // Task 9c — legacy client/agent columns intentionally DIVERGE from
            // inspection_people below (stale decoy values). getInspectionHub
            // must resolve `inspection.clientName/clientEmail/clientPhone/
            // clientContactId/referredByAgentId/sellingAgentId` from
            // inspection_people (PeopleService.getPrimaryClient /
            // contactIdForRole), never these columns — they survive GDPR
            // erasure as a stale denormalized cache and would leak an erased
            // subject's PII.
            clientContactId: 'stale-contact-id',
            clientName: 'STALE-LEGACY-NAME', clientEmail: 'stale-legacy@example.com', clientPhone: '000-000-0000',
            templateId: 'tpl-1', referredByAgentId: 'stale-agent-buyer', sellingAgentId: 'stale-agent-listing',
            coverPhotoId: 'cover-1', date: '2026-06-01', status: 'completed',
            paymentStatus: 'unpaid', price: 35000, paymentRequired: true, agreementRequired: true,
            createdAt: new Date(),
        });
        await people.addPerson(TENANT, 'insp-full', 'client-1',        roleProfileId(TENANT, 'client'));
        await people.addPerson(TENANT, 'insp-full', 'agent-buyer-1',   roleProfileId(TENANT, 'buyer_agent'));
        await people.addPerson(TENANT, 'insp-full', 'agent-listing-1', roleProfileId(TENANT, 'listing_agent'));
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

        // inspection block — sourced from inspection_people (Task 9c), not the
        // deliberately-divergent legacy columns seeded above.
        expect(hub.inspection).toMatchObject({
            id: 'insp-full', propertyAddress: '1 Main St', clientName: 'Jane Buyer',
            clientEmail: 'jane@example.com', clientPhone: '+15551234567', clientContactId: 'client-1',
            status: 'completed', inspectorId: 'user-insp', templateId: 'tpl-1', price: 35000,
            paymentStatus: 'unpaid', paymentRequired: true, agreementRequired: true,
            coverPhoto: 'cover-1', referredByAgentId: 'agent-buyer-1', sellingAgentId: 'agent-listing-1',
        });
        expect(hub.inspection.clientName).not.toBe('STALE-LEGACY-NAME');
        expect(hub.inspection.clientEmail).not.toBe('stale-legacy@example.com');
        expect(hub.inspection.clientPhone).not.toBe('000-000-0000');
        expect(hub.inspection.clientContactId).not.toBe('stale-contact-id');
        expect(hub.inspection.referredByAgentId).not.toBe('stale-agent-buyer');
        expect(hub.inspection.sellingAgentId).not.toBe('stale-agent-listing');
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
        await testDb.insert(schema.contacts).values({
            id: 'client-bare', tenantId: TENANT, type: 'client', name: 'Jane', email: null, phone: null, createdAt: new Date(),
        });
        await testDb.insert(schema.inspections).values({
            id: 'insp-bare', tenantId: TENANT, propertyAddress: '1 Main St',
            clientName: 'Jane', clientEmail: null, clientPhone: null,
            date: '2026-06-01', status: 'requested', paymentStatus: 'unpaid',
            price: 0, paymentRequired: false, agreementRequired: false, createdAt: new Date(),
        });
        await people.addPerson(TENANT, 'insp-bare', 'client-bare', roleProfileId(TENANT, 'client'));

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
