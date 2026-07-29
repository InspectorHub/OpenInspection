import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MessageService } from '../../../server/services/message.service';
import { PeopleService } from '../../../server/services/people.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import { createTestDb, setupSchema } from '../db';
import { inspectionMessages, inspections, tenants, contacts } from '../../../server/lib/db/schema';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

describe('MessageService', () => {
    let svc: MessageService;
    let testDb: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const setup = createTestDb();
        testDb = setup.db;
        await setupSchema(setup.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        await testDb.insert(tenants).values({ id: 't1', name: 'T', slug: 't1', createdAt: new Date() });
        await testDb.insert(inspections).values({
            id: 'i1', tenantId: 't1', propertyAddress: '1 Main', date: '2026-05-01',
            createdAt: new Date(), price: 0,
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        svc = new MessageService({} as any);
    });

    it('createMessage inserts a row and returns it', async () => {
        const row = await svc.createMessage({
            tenantId: 't1', inspectionId: 'i1', contactId: 'contact-client-1', fromRole: 'inspector',
            fromUserId: 'u-staff', fromName: 'Mike', body: 'Hello', attachments: [],
        });
        expect(row.id).toBeTruthy();
        expect(row.contactId).toBe('contact-client-1');
        expect(row.fromUserId).toBe('u-staff');
        const all = await testDb.select().from(inspectionMessages);
        expect(all).toHaveLength(1);
    });

    it('listForInspection returns messages oldest-first', async () => {
        await svc.createMessage({ tenantId: 't1', inspectionId: 'i1', contactId: 'c1', fromRole: 'inspector', body: 'a', attachments: [] });
        await svc.createMessage({ tenantId: 't1', inspectionId: 'i1', contactId: 'c1', fromRole: 'client', body: 'b', attachments: [] });
        const list = await svc.listForInspection('i1', 't1');
        expect(list).toHaveLength(2);
        expect(list[0].body).toBe('a');
    });

    it('unreadCountForTenant counts every unread counterparty message, not only client rows', async () => {
        // The old filter was fromRole = 'client'; once agents post, their rows
        // would have stayed permanently invisible in the sidebar badge.
        await svc.createMessage({ tenantId: 't1', inspectionId: 'i1', contactId: 'c1', fromRole: 'client', body: 'hi', attachments: [] });
        await svc.createMessage({ tenantId: 't1', inspectionId: 'i1', contactId: 'c2', fromRole: 'agent', body: 'report?', attachments: [] });
        await svc.createMessage({ tenantId: 't1', inspectionId: 'i1', contactId: 'c1', fromRole: 'inspector', body: 'hi back', attachments: [] });
        const count = await svc.unreadCountForTenant('t1');
        expect(count).toBe(2);
    });

    it('markInspectionReadForStaff marks counterparty rows, never staff rows', async () => {
        await svc.createMessage({ tenantId: 't1', inspectionId: 'i1', contactId: 'c1', fromRole: 'client', body: 'a', attachments: [] });
        await svc.createMessage({ tenantId: 't1', inspectionId: 'i1', contactId: 'c2', fromRole: 'agent', body: 'q', attachments: [] });
        await svc.createMessage({ tenantId: 't1', inspectionId: 'i1', contactId: 'c1', fromRole: 'inspector', body: 'b', attachments: [] });
        await svc.markInspectionReadForStaff('i1', 't1');
        const list = await svc.listForInspection('i1', 't1');
        expect(list.find(m => m.fromRole === 'client')?.readAt).not.toBeNull();
        expect(list.find(m => m.fromRole === 'agent')?.readAt).not.toBeNull();
        expect(list.find(m => m.fromRole === 'inspector')?.readAt).toBeNull();
    });

    it('markThreadReadForContact clears ONE thread, not the whole inspection', async () => {
        // Two contacts each have an unread staff reply. The first contact
        // opening their portal must not clear the second contact's unread state
        // — an inspection-wide mark is exactly the bug per-contact threading
        // exists to prevent.
        await svc.createMessage({ tenantId: 't1', inspectionId: 'i1', contactId: 'c1', fromRole: 'inspector', body: 'to c1', attachments: [] });
        await svc.createMessage({ tenantId: 't1', inspectionId: 'i1', contactId: 'c2', fromRole: 'inspector', body: 'to c2', attachments: [] });
        await svc.markThreadReadForContact('t1', 'c1', 'i1');
        const list = await svc.listForInspection('i1', 't1');
        expect(list.find(m => m.contactId === 'c1')?.readAt).not.toBeNull();
        expect(list.find(m => m.contactId === 'c2')?.readAt).toBeNull();
    });

    /**
     * Task 9a (people-role-profiles) — clientEmailForInspection /
     * clientNameForInspection resolve via PeopleService.getPrimaryClient
     * (inspection_people join) instead of the legacy
     * inspections.clientEmail/.clientName columns, which are being dropped
     * (Task 13). i1 above intentionally carries no legacy client columns
     * (they default NULL) — only the inspection_people row below supplies
     * the primary client, so these specs fail against the old
     * implementation (which reads only the legacy columns and returns null).
     */
    describe('clientEmailForInspection / clientNameForInspection — primary-client join', () => {
        const roleProfileId = (key: string) => `crp_t1_${key}`;

        beforeEach(async () => {
            await seedRoleProfiles(testDb, 't1', new Date(1));
            await testDb.insert(contacts).values({
                id: 'contact-client-1', tenantId: 't1', type: 'client', name: 'Jane Client',
                email: 'jane@example.com', phone: null, createdAt: new Date(),
            });
        });

        it('resolves the client email from the primary-client join', async () => {
            const people = new PeopleService({ DB: {} as D1Database });
            await people.addPerson('t1', 'i1', 'contact-client-1', roleProfileId('client'));

            const email = await svc.clientEmailForInspection('i1', 't1');
            expect(email).toBe('jane@example.com');
        });

        it('resolves the client name from the primary-client join', async () => {
            const people = new PeopleService({ DB: {} as D1Database });
            await people.addPerson('t1', 'i1', 'contact-client-1', roleProfileId('client'));

            const name = await svc.clientNameForInspection('i1', 't1');
            expect(name).toBe('Jane Client');
        });

        it('no primary client — both resolve null', async () => {
            expect(await svc.clientEmailForInspection('i1', 't1')).toBeNull();
            expect(await svc.clientNameForInspection('i1', 't1')).toBeNull();
        });
    });

    /**
     * IA-108 (the co-client half) — a portal actor's messages attribute to
     * THEIR OWN seat, matched by the email they authenticated with. The old
     * path signed every client-side message with the primary client's name.
     */
    describe('resolveThreadContact — the co-client attribution fix', () => {
        const roleProfileId = (key: string) => `crp_t1_${key}`;

        beforeEach(async () => {
            await seedRoleProfiles(testDb, 't1', new Date(1));
            await testDb.insert(contacts).values([
                { id: 'contact-client-1', tenantId: 't1', type: 'client', name: 'Jane Client', email: 'jane@example.com', phone: null, createdAt: new Date() },
                { id: 'contact-coclient-1', tenantId: 't1', type: 'client', name: 'Joe Spouse', email: 'joe@example.com', phone: null, createdAt: new Date() },
            ]);
            const people = new PeopleService({ DB: {} as D1Database });
            await people.addPerson('t1', 'i1', 'contact-client-1', roleProfileId('client'));
            await people.addPerson('t1', 'i1', 'contact-coclient-1', roleProfileId('co_client'));
        });

        it("resolves the CO-CLIENT's own seat by their verified email", async () => {
            const thread = await svc.resolveThreadContact('t1', 'i1', 'joe@example.com');
            expect(thread?.contactId).toBe('contact-coclient-1');
            expect(thread?.name).toBe('Joe Spouse');
        });

        it('matches the email case-insensitively', async () => {
            const thread = await svc.resolveThreadContact('t1', 'i1', 'JOE@Example.COM');
            expect(thread?.contactId).toBe('contact-coclient-1');
        });

        it('falls back to the primary client when no seat matches the email', async () => {
            const thread = await svc.resolveThreadContact('t1', 'i1', 'stranger@example.com');
            expect(thread?.contactId).toBe('contact-client-1');
        });

        it('contactOnInspection refuses a contact with no seat here', async () => {
            await testDb.insert(contacts).values({
                id: 'contact-elsewhere', tenantId: 't1', type: 'client', name: 'Not Here',
                email: 'x@example.com', phone: null, createdAt: new Date(),
            });
            expect(await svc.contactOnInspection('t1', 'i1', 'contact-elsewhere')).toBeNull();
            expect((await svc.contactOnInspection('t1', 'i1', 'contact-coclient-1'))?.contactId).toBe('contact-coclient-1');
        });
    });
});
