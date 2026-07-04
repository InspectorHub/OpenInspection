import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InspectionService } from '../../../server/services/inspection.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-000000000001';

describe('Round-2 F1 — InspectionService.getRecipientList', () => {
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
            { id: TENANT, name: 'Acme', slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        ]);
    });

    it('returns empty list when inspection has no contacts', async () => {
        await testDb.insert(schema.inspections).values({
            id:              'insp-empty',
            tenantId:        TENANT,
            propertyAddress: '1 Main St',
            clientName:      null,
            clientEmail:     null,
            clientPhone:     null,
            date:            '2026-06-01',
            status:          'completed',
            paymentStatus:   'unpaid',
            price:           0,
            paymentRequired: false,
            agreementRequired: false,
            createdAt:       new Date(),
        });

        const list = await svc.getRecipientList('insp-empty', TENANT);
        expect(list).toEqual([]);
    });

    it('returns just the client when no agents linked', async () => {
        await testDb.insert(schema.inspections).values({
            id:              'insp-client-only',
            tenantId:        TENANT,
            propertyAddress: '1 Main St',
            clientName:      'Jane Buyer',
            clientEmail:     'jane@example.com',
            clientPhone:     '+15551234567',
            date:            '2026-06-01',
            status:          'completed',
            paymentStatus:   'unpaid',
            price:           0,
            paymentRequired: false,
            agreementRequired: false,
            createdAt:       new Date(),
        });

        const list = await svc.getRecipientList('insp-client-only', TENANT);
        expect(list).toHaveLength(1);
        expect(list[0]).toMatchObject({
            role: 'client',
            name: 'Jane Buyer',
            email: 'jane@example.com',
            phone: '+15551234567',
        });
    });

    it('returns client + buyer agent + listing agent when all linked', async () => {
        // Buyer's Agent (referredByAgentId)
        await testDb.insert(schema.contacts).values([
            {
                id:        'agent-buyer-1',
                tenantId:  TENANT,
                type:      'agent',
                name:      'Bob Buyer-Agent',
                email:     'bob@bba.com',
                phone:     '+15550001111',
                createdAt: new Date(),
            },
            {
                id:        'agent-listing-1',
                tenantId:  TENANT,
                type:      'agent',
                name:      'Lisa Listing-Agent',
                email:     'lisa@lla.com',
                phone:     null,
                createdAt: new Date(),
            },
        ]);

        await testDb.insert(schema.inspections).values({
            id:                'insp-3-people',
            tenantId:          TENANT,
            propertyAddress:   '1 Main St',
            clientName:        'Jane Buyer',
            clientEmail:       'jane@example.com',
            clientPhone:       '+15551234567',
            referredByAgentId: 'agent-buyer-1',
            sellingAgentId:    'agent-listing-1',
            date:              '2026-06-01',
            status:            'completed',
            paymentStatus:     'unpaid',
            price:             0,
            paymentRequired:   false,
            agreementRequired: false,
            createdAt:         new Date(),
        });

        const list = await svc.getRecipientList('insp-3-people', TENANT);
        expect(list).toHaveLength(3);

        const client  = list.find(p => p.role === 'client');
        const buyer   = list.find(p => p.role === 'agent_buyer');
        const listing = list.find(p => p.role === 'agent_listing');

        expect(client).toMatchObject({  name: 'Jane Buyer',         email: 'jane@example.com', phone: '+15551234567' });
        expect(buyer).toMatchObject({   name: 'Bob Buyer-Agent',    email: 'bob@bba.com',      contactId: 'agent-buyer-1' });
        expect(listing).toMatchObject({ name: 'Lisa Listing-Agent', email: 'lisa@lla.com',     phone: null });
    });

    it('throws NotFound for an inspection in another tenant', async () => {
        const OTHER = '00000000-0000-0000-0000-0000000000ff';
        await testDb.insert(schema.tenants).values({
            id: OTHER, name: 'Other', slug: 'other', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await testDb.insert(schema.inspections).values({
            id: 'insp-other', tenantId: OTHER,
            propertyAddress: 'X', clientName: null, clientEmail: null, clientPhone: null,
            date: '2026-06-01', status: 'completed', paymentStatus: 'unpaid',
            price: 0, paymentRequired: false, agreementRequired: false, createdAt: new Date(),
        });

        await expect(svc.getRecipientList('insp-other', TENANT)).rejects.toThrow();
    });

    it('drops contacts that have neither email nor phone', async () => {
        await testDb.insert(schema.contacts).values({
            id:        'agent-noinfo',
            tenantId:  TENANT,
            type:      'agent',
            name:      'No Contact Info',
            email:     null,
            phone:     null,
            createdAt: new Date(),
        });
        await testDb.insert(schema.inspections).values({
            id:                'insp-noinfo',
            tenantId:          TENANT,
            propertyAddress:   '1 Main St',
            clientName:        'Has Email',
            clientEmail:       'real@example.com',
            clientPhone:       null,
            referredByAgentId: 'agent-noinfo',
            date:              '2026-06-01',
            status:            'completed',
            paymentStatus:     'unpaid',
            price:             0,
            paymentRequired:   false,
            agreementRequired: false,
            createdAt:         new Date(),
        });

        const list = await svc.getRecipientList('insp-noinfo', TENANT);
        // Client kept (has email), agent dropped (no email and no phone).
        expect(list).toHaveLength(1);
        expect(list[0]?.role).toBe('client');
    });
});
