/**
 * IA-36 ⑫⑬ — primary client is an ASSIGNMENT that moves between people, not an
 * identity welded to one contact.
 *
 * Before this, `role === 'client'` WAS the primary client, a second one was a
 * 409, and the UI hid Remove on that row — so a wrong pick in the wizard had no
 * in-product way back. The invariant ("exactly one primary client") is now held
 * up by an atomic swap instead of by refusing to move.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { PeopleService } from '../../../server/services/people.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import { isSoleClient } from '../../../server/lib/people/primary-client';

const rp = (key: string) => `crp_t1_${key}`;

describe('PeopleService.makePrimary', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let svc: PeopleService; let db: any;

    beforeEach(async () => {
        const f = createTestDb(); db = f.db; await setupSchema(f.sqlite);
        await seedRoleProfiles(db, 't1', new Date(1));
        await db.insert(schema.tenants).values([
            { id: 't1', slug: 't1', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(1) },
        ]);
        await db.insert(schema.contacts).values([
            { id: 'c1', tenantId: 't1', type: 'client', name: 'Buyer One', email: 'b1@x.com', createdAt: new Date(1) },
            { id: 'c2', tenantId: 't1', type: 'client', name: 'Buyer Two', email: 'b2@x.com', createdAt: new Date(1) },
            { id: 'c3', tenantId: 't1', type: 'agent', name: 'Agent', email: 'a@x.com', createdAt: new Date(1) },
        ]);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(db);
        svc = new PeopleService({} as never);
    });

    async function rowFor(contactId: string) {
        const people = await svc.listPeople('t1', 'i1');
        return people.find((p) => p.contactId === contactId)!;
    }

    it('swaps: the target becomes client and the incumbent becomes co_client', async () => {
        await svc.addPerson('t1', 'i1', 'c1', rp('client'));
        await svc.addPerson('t1', 'i1', 'c2', rp('co_client'));

        await svc.makePrimary('t1', 'i1', (await rowFor('c2')).id);

        expect((await rowFor('c2')).roleKey).toBe('client');
        expect((await rowFor('c1')).roleKey).toBe('co_client');
        // The invariant still holds — exactly one.
        const people = await svc.listPeople('t1', 'i1');
        expect(people.filter((p) => p.roleKey === 'client')).toHaveLength(1);
        expect(await svc.getPrimaryClient('t1', 'i1')).toMatchObject({ contactId: 'c2' });
    });

    it('the demoted incumbent STAYS on the inspection (they did not leave — their access is untouched)', async () => {
        await svc.addPerson('t1', 'i1', 'c1', rp('client'));
        await svc.addPerson('t1', 'i1', 'c2', rp('co_client'));
        await svc.makePrimary('t1', 'i1', (await rowFor('c2')).id);
        expect((await svc.listPeople('t1', 'i1')).map((p) => p.contactId).sort()).toEqual(['c1', 'c2']);
    });

    it('promotes when there is no incumbent at all', async () => {
        await svc.addPerson('t1', 'i1', 'c2', rp('co_client'));
        await svc.makePrimary('t1', 'i1', (await rowFor('c2')).id);
        expect((await rowFor('c2')).roleKey).toBe('client');
    });

    it('is a no-op on the row that is already primary', async () => {
        await svc.addPerson('t1', 'i1', 'c1', rp('client'));
        await svc.makePrimary('t1', 'i1', (await rowFor('c1')).id);
        expect((await rowFor('c1')).roleKey).toBe('client');
        expect(await svc.listPeople('t1', 'i1')).toHaveLength(1);
    });

    it('refuses a non-client-kind person — an agent must never become the client', async () => {
        await svc.addPerson('t1', 'i1', 'c1', rp('client'));
        await svc.addPerson('t1', 'i1', 'c3', rp('buyer_agent'));
        await expect(svc.makePrimary('t1', 'i1', (await rowFor('c3')).id)).rejects.toThrow();
        expect((await rowFor('c1')).roleKey).toBe('client');
    });

    it('404s on an unknown person id', async () => {
        await expect(svc.makePrimary('t1', 'i1', 'nope')).rejects.toThrow();
    });

    it('is tenant-scoped', async () => {
        await svc.addPerson('t1', 'i1', 'c1', rp('client'));
        await svc.addPerson('t1', 'i1', 'c2', rp('co_client'));
        await expect(svc.makePrimary('t2', 'i1', (await rowFor('c2')).id)).rejects.toThrow();
        expect((await rowFor('c1')).roleKey).toBe('client');
    });
});

describe('addPerson with the primary role when one already exists', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let svc: PeopleService; let db: any;

    beforeEach(async () => {
        const f = createTestDb(); db = f.db; await setupSchema(f.sqlite);
        await seedRoleProfiles(db, 't1', new Date(1));
        await db.insert(schema.tenants).values([
            { id: 't1', slug: 't1', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(1) },
        ]);
        await db.insert(schema.contacts).values([
            { id: 'c1', tenantId: 't1', type: 'client', name: 'Buyer One', email: 'b1@x.com', createdAt: new Date(1) },
            { id: 'c2', tenantId: 't1', type: 'client', name: 'Buyer Two', email: 'b2@x.com', createdAt: new Date(1) },
        ]);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(db);
        svc = new PeopleService({} as never);
    });

    it('hands the seat over instead of dead-ending on a 409', async () => {
        await svc.addPerson('t1', 'i1', 'c1', rp('client'));
        await svc.addPerson('t1', 'i1', 'c2', rp('client'));

        const people = await svc.listPeople('t1', 'i1');
        expect(people.filter((p) => p.roleKey === 'client').map((p) => p.contactId)).toEqual(['c2']);
        expect(people.filter((p) => p.roleKey === 'co_client').map((p) => p.contactId)).toEqual(['c1']);
    });

    it('adding the SAME contact again as primary changes nothing', async () => {
        await svc.addPerson('t1', 'i1', 'c1', rp('client'));
        await svc.addPerson('t1', 'i1', 'c1', rp('client'));
        expect(await svc.listPeople('t1', 'i1')).toHaveLength(1);
        expect(await svc.getPrimaryClient('t1', 'i1')).toMatchObject({ contactId: 'c1' });
    });
});

describe('isSoleClient — the reason Remove is disabled, stated instead of hidden', () => {
    const people = [
        { id: 'p1', roleKey: 'client', kind: 'client' as const },
        { id: 'p2', roleKey: 'buyer_agent', kind: 'agent' as const },
    ];

    it('true for the only client-kind person on the inspection', () => {
        expect(isSoleClient(people, 'p1')).toBe(true);
    });

    it('false once a second client-kind person exists', () => {
        expect(isSoleClient([...people, { id: 'p3', roleKey: 'co_client', kind: 'client' }], 'p1')).toBe(false);
    });

    it('false for a non-client row — agents are freely removable', () => {
        expect(isSoleClient(people, 'p2')).toBe(false);
    });

    it('false for an id that is not on the inspection', () => {
        expect(isSoleClient(people, 'ghost')).toBe(false);
    });
});
