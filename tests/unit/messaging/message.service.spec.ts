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
            tenantId: 't1', inspectionId: 'i1', fromRole: 'inspector',
            fromName: 'Mike', body: 'Hello', attachments: [],
        });
        expect(row.id).toBeTruthy();
        const all = await testDb.select().from(inspectionMessages);
        expect(all).toHaveLength(1);
    });

    it('listForInspection returns messages oldest-first', async () => {
        await svc.createMessage({ tenantId: 't1', inspectionId: 'i1', fromRole: 'inspector', body: 'a', attachments: [] });
        await svc.createMessage({ tenantId: 't1', inspectionId: 'i1', fromRole: 'client', body: 'b', attachments: [] });
        const list = await svc.listForInspection('i1', 't1');
        expect(list).toHaveLength(2);
        expect(list[0].body).toBe('a');
    });

    it('unreadCountForTenant counts unread client messages only', async () => {
        await svc.createMessage({ tenantId: 't1', inspectionId: 'i1', fromRole: 'client', body: 'hi', attachments: [] });
        await svc.createMessage({ tenantId: 't1', inspectionId: 'i1', fromRole: 'inspector', body: 'hi back', attachments: [] });
        const count = await svc.unreadCountForTenant('t1');
        expect(count).toBe(1);
    });

    it('markAllReadForRole only marks specified role', async () => {
        await svc.createMessage({ tenantId: 't1', inspectionId: 'i1', fromRole: 'client', body: 'a', attachments: [] });
        await svc.createMessage({ tenantId: 't1', inspectionId: 'i1', fromRole: 'inspector', body: 'b', attachments: [] });
        await svc.markAllReadForRole('i1', 't1', 'client');
        const list = await svc.listForInspection('i1', 't1');
        expect(list.find(m => m.fromRole === 'client')?.readAt).not.toBeNull();
        expect(list.find(m => m.fromRole === 'inspector')?.readAt).toBeNull();
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
});
