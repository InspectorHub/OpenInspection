/**
 * Task 7 (two-layer role model) — every capability consumer reads per-profile
 * overrides. Widening a bit list without moving its consumers leaves the new
 * bits unreadable (feedback_audit_downstream_filters_when_adding_fields):
 * a role whose receivesReport was WITHDRAWN by override must actually stop
 * receiving, everywhere the bit is consulted.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PeopleService } from '../../../server/services/people.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const T = 't-capcon-1';
const INSP = 'i-capcon-1';

let db: BetterSQLite3Database<typeof schema>;

describe('capability consumers honour per-profile overrides', () => {
    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        await setupSchema(fixture.sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

        await db.insert(schema.tenants).values({ id: T, name: 'T', slug: 't-capcon', createdAt: new Date() });
        await db.insert(schema.inspections).values({
            id: INSP, tenantId: T, propertyAddress: '1 Main', date: '2026-07-01', createdAt: new Date(), price: 0,
        });
        // An agent-kind role (kind default receivesReport: true) whose override
        // WITHDRAWS it — the exact case a kind-only read cannot see.
        await db.insert(schema.contactRoleProfiles).values([
            { id: 'crp-muted', tenantId: T, key: 'muted_agent', label: 'Muted Agent', kind: 'agent', active: true,
              capabilityOverrides: { receivesReport: false }, createdAt: new Date(), updatedAt: new Date() },
            { id: 'crp-normal', tenantId: T, key: 'buyer_agent', label: "Buyer's Agent", kind: 'agent', active: true,
              capabilityOverrides: null, createdAt: new Date(), updatedAt: new Date() },
        ] as never);
        await db.insert(schema.contacts).values([
            { id: 'ct-muted', tenantId: T, type: 'agent', name: 'Muted', email: 'muted@x.com', phone: null, createdAt: new Date() },
            { id: 'ct-normal', tenantId: T, type: 'agent', name: 'Normal', email: 'normal@x.com', phone: null, createdAt: new Date() },
        ]);
        await db.insert(schema.inspectionPeople).values([
            { id: 'ip-muted', tenantId: T, inspectionId: INSP, contactId: 'ct-muted', roleProfileId: 'crp-muted', createdAt: new Date() },
            { id: 'ip-normal', tenantId: T, inspectionId: INSP, contactId: 'ct-normal', roleProfileId: 'crp-normal', createdAt: new Date() },
        ]);
    });

    it('roleProfileIdsWithCapability omits the withdrawn profile', async () => {
        const ids = await new PeopleService({ DB: {} as D1Database }).roleProfileIdsWithCapability(T, 'receivesReport');
        expect(ids).toContain('crp-normal');
        expect(ids).not.toContain('crp-muted');
    });

    it('roleKeysWithCapability omits the withdrawn key too', async () => {
        const keys = await new PeopleService({ DB: {} as D1Database }).roleKeysWithCapability(T, 'receivesReport');
        expect(keys).toContain('buyer_agent');
        expect(keys).not.toContain('muted_agent');
    });

    it('listPeople carries the overrides so downstream filters can resolve them', async () => {
        const people = await new PeopleService({ DB: {} as D1Database }).listPeople(T, INSP);
        const muted = people.find(p => p.contactId === 'ct-muted');
        expect(muted).toBeTruthy();
        // The row itself stays listed (the person IS on the inspection); what
        // travels with it is the material to answer capability questions.
        expect(muted!.capabilityOverrides).toEqual({ receivesReport: false });
    });
});
