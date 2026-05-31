import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MessageService } from '../../src/services/message.service';
import { createTestDb, setupSchema } from './db';
import { customerMessages, inspections, tenants } from '../../src/lib/db/schema';
import * as schema from '../../src/lib/db/schema';
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
        await testDb.insert(tenants).values({ id: 't1', name: 'T', subdomain: 't1', createdAt: new Date() });
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
        const all = await testDb.select().from(customerMessages);
        expect(all).toHaveLength(1);
    });

    it('listForInspection returns messages oldest-first', async () => {
        await svc.createMessage({ tenantId: 't1', inspectionId: 'i1', fromRole: 'inspector', body: 'a', attachments: [] });
        await svc.createMessage({ tenantId: 't1', inspectionId: 'i1', fromRole: 'client', body: 'b', attachments: [] });
        const list = await svc.listForInspection('i1', 't1');
        expect(list).toHaveLength(2);
        expect(list[0].body).toBe('a');
    });

    it('getOrCreateToken returns same token on second call', async () => {
        const t1 = await svc.getOrCreateToken('i1', 't1');
        const t2 = await svc.getOrCreateToken('i1', 't1');
        expect(t1).toBe(t2);
        expect(t1).toMatch(/^[0-9a-f]{32}$/);
    });

    it('resolveByToken returns inspection only when token matches', async () => {
        const t = await svc.getOrCreateToken('i1', 't1');
        const insp = await svc.resolveByToken(t);
        expect(insp?.id).toBe('i1');
        const none = await svc.resolveByToken('00000000000000000000000000000000');
        expect(none).toBeNull();
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
});
