/**
 * A client named without an e-mail address, created by someone who sees only their assignments.
 *
 * The rule (see `upsertContactByEmail`): a name is not an identity, so it matches only a contact the caller CREATED
 * and that carries no address; several of those resolve to the most recently created. Any other contact of that
 * name, visible or not, is a different person and is neither matched nor touched. Unrestricted callers keep the old
 * behaviour. The same rule is checked end to end through POST /api/inspections in `restricted-create-contacts.spec.ts`;
 * this file pins the service in isolation.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { createTestDb, setupSchema } from '../db';
import { asD1Db, asD1DrizzleReturn } from '../helpers/test-db';
import * as schema from '../../../server/lib/db/schema';
import { ContactService } from '../../../server/services/contact.service';
import { PeopleService } from '../../../server/services/people.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import { seedVisibilityFixture, TENANT, USERS, INSP } from '../helpers/visibility-fixture';
import { ALL_INSPECTIONS, type InspectionScope } from '../../../server/lib/inspection/visibility';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

const A: InspectionScope = { kind: 'assigned', userId: USERS.inspA };
const rp = (key: string) => `crp_${TENANT}_${key}`;

describe('name-only client upsert honours the scope', () => {
    let db: ReturnType<typeof createTestDb>['db'];
    let service: ContactService;

    beforeEach(async () => {
        const f = createTestDb(); db = f.db; await setupSchema(f.sqlite); await seedVisibilityFixture(db);
        vi.mocked(drizzle).mockReturnValue(asD1DrizzleReturn(db));
        service = new ContactService({} as D1Database);
        await seedRoleProfiles(asD1Db(db), TENANT, new Date(1));
        await db.insert(schema.contacts).values([
            { id: 'c-visible', name: 'Pat Visible', email: null, createdByUserId: USERS.inspA, createdAt: new Date(1000) },
            { id: 'c-visible-theirs', name: 'Pat Theirs', email: null, createdByUserId: USERS.inspB, createdAt: new Date(1000) },
            { id: 'c-visible-addr', name: 'Pat Addressed', email: 'pat@visible.test', createdByUserId: USERS.inspA, createdAt: new Date(1000) },
            { id: 'c-hidden', name: 'Pat Hidden', email: 'hidden@example.test', phone: '555-0100', notes: 'private', createdAt: new Date(1000) },
            { id: 'c-dup-old', name: 'Pat Twin', email: null, createdByUserId: USERS.inspA, createdAt: new Date(1000) },
            { id: 'c-dup-new', name: 'Pat Twin', email: null, createdByUserId: USERS.inspA, createdAt: new Date(2000) },
        ].map(r => ({ tenantId: TENANT, type: 'client' as const, ...r })));
        const people = new PeopleService({ DB: {} as D1Database });
        await people.addPerson(TENANT, INSP.own, 'c-visible', rp('client'));
        await people.addPerson(TENANT, INSP.own, 'c-visible-theirs', rp('client'));
        await people.addPerson(TENANT, INSP.own, 'c-visible-addr', rp('client'));
        await people.addPerson(TENANT, INSP.own, 'c-dup-old', rp('client'));
        await people.addPerson(TENANT, INSP.team, 'c-dup-new', rp('client'));
        await people.addPerson(TENANT, INSP.other, 'c-hidden', rp('client'));
    });

    const named = (name: string) => db.select().from(schema.contacts)
        .where(and(eq(schema.contacts.tenantId, TENANT), eq(schema.contacts.name, name))).all();

    it('a visible contact of that name that someone else made, or that carries an address, is another person: a new one is made', async () => {
        const theirs = await service.upsertClientContact(TENANT, { name: 'Pat Theirs', type: 'client' }, A);
        const addressed = await service.upsertClientContact(TENANT, { name: 'Pat Addressed', type: 'client' }, A);
        expect(theirs.created).toBe(true);
        expect(addressed.created).toBe(true);
        expect(new Set([theirs.id, addressed.id])).not.toContain('c-visible-theirs');
        expect(await named('Pat Addressed')).toHaveLength(2);
        const row = await db.select().from(schema.contacts).where(eq(schema.contacts.id, addressed.id)).get();
        expect(row).toMatchObject({ email: null, createdByUserId: USERS.inspA });
    });

    it('reuses the one address-less contact of that name that the caller made', async () => {
        const r = await service.upsertClientContact(TENANT, { name: 'Pat Visible', type: 'client' }, A);
        expect(r).toEqual({ id: 'c-visible', created: false });
        expect(await named('Pat Visible')).toHaveLength(1);
    });

    it('the same name twice in a row yields one contact (the duplicate this closes)', async () => {
        const first = await service.upsertClientContact(TENANT, { name: 'Fresh Client', type: 'client' }, A);
        const second = await service.upsertClientContact(TENANT, { name: 'Fresh Client', type: 'client' }, A);
        expect(first.created).toBe(true);
        expect(second).toEqual({ id: first.id, created: false });
        expect(await named('Fresh Client')).toHaveLength(1);
    });

    it('a contact the caller made but has not yet attached to anything is also theirs to reuse', async () => {
        await db.insert(schema.contacts).values({ id: 'c-made', tenantId: TENANT, type: 'client', name: 'Made By Me', createdByUserId: USERS.inspA, createdAt: new Date() });
        expect((await service.upsertClientContact(TENANT, { name: 'Made By Me', type: 'client' }, A)).id).toBe('c-made');
    });

    it('a name shared by several of the callers own contacts resolves to the most recently created one', async () => {
        const r = await service.upsertClientContact(TENANT, { name: 'Pat Twin', type: 'client' }, A);
        expect(r).toEqual({ id: 'c-dup-new', created: false });
        expect(await named('Pat Twin')).toHaveLength(2);
    });

    it('a name that only a HIDDEN contact carries creates a new contact and leaves the hidden one untouched', async () => {
        const before = await db.select().from(schema.contacts).where(eq(schema.contacts.id, 'c-hidden')).get();
        const r = await service.upsertClientContact(TENANT, { name: 'Pat Hidden', phone: '555-9999', type: 'client' }, A);
        expect(r.created).toBe(true);
        expect(r.id).not.toBe('c-hidden');
        const after = await db.select().from(schema.contacts).where(eq(schema.contacts.id, 'c-hidden')).get();
        expect(after).toEqual(before);
        const mine = await db.select().from(schema.contacts).where(eq(schema.contacts.id, r.id)).get();
        expect(mine).toMatchObject({ name: 'Pat Hidden', email: null, phone: '555-9999', notes: null });
    });

    it('does not match an archived contact or a contact of another type', async () => {
        await db.insert(schema.contacts).values([
            { id: 'c-arch', tenantId: TENANT, type: 'client', name: 'Archived Ann', archivedAt: new Date(), createdByUserId: USERS.inspA, createdAt: new Date() },
            { id: 'c-agent', tenantId: TENANT, type: 'agent', name: 'Agent Amy', createdByUserId: USERS.inspA, createdAt: new Date() },
        ]);
        expect((await service.upsertClientContact(TENANT, { name: 'Archived Ann', type: 'client' }, A)).created).toBe(true);
        expect((await service.upsertClientContact(TENANT, { name: 'Agent Amy', type: 'client' }, A)).created).toBe(true);
        expect((await service.upsertClientContact(TENANT, { name: 'Agent Amy', type: 'agent' }, A)).id).toBe('c-agent');
    });

    it('control: an unrestricted caller still gets a fresh name-only row each time', async () => {
        const a = await service.upsertClientContact(TENANT, { name: 'Pat Visible', type: 'client' }, ALL_INSPECTIONS);
        expect(a.created).toBe(true);
        expect(a.id).not.toBe('c-visible');
    });

    it('control: a hidden address is still refused', async () => {
        await expect(service.upsertClientContact(TENANT, { name: 'x', email: 'hidden@example.test', type: 'client' }, A))
            .rejects.toMatchObject({ status: 409 });
    });
});
