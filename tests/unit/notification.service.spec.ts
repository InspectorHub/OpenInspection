import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotificationService } from '../../src/services/notification.service';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../src/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT_A = '00000000-0000-0000-0000-000000000001';
const TENANT_B = '00000000-0000-0000-0000-000000000002';
const USER_1   = '00000000-0000-0000-0000-0000000000a1';
const USER_2   = '00000000-0000-0000-0000-0000000000a2';

async function seedTenantAndUsers(testDb: BetterSQLite3Database<typeof schema>) {
    await testDb.insert(schema.tenants).values([
        { id: TENANT_A, name: 'A', subdomain: 'a', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        { id: TENANT_B, name: 'B', subdomain: 'b', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
    ]);
    await testDb.insert(schema.users).values([
        { id: USER_1, tenantId: TENANT_A, email: 'u1@a.com', name: 'U1', passwordHash: 'x', role: 'admin', createdAt: new Date() },
        { id: USER_2, tenantId: TENANT_A, email: 'u2@a.com', name: 'U2', passwordHash: 'x', role: 'owner', createdAt: new Date() },
    ]);
}

describe('NotificationService', () => {
    let svc: NotificationService;
    let testDb: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const setup = createTestDb();
        testDb = setup.db;
        await setupSchema(setup.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        svc = new NotificationService({} as any);
        await seedTenantAndUsers(testDb);
    });

    it('create() inserts a single notification scoped to a user', async () => {
        await svc.create({ tenantId: TENANT_A, userId: USER_1, type: 'message.received', title: 'New message' });
        const list = await svc.list(TENANT_A, USER_1, {});
        expect(list.items).toHaveLength(1);
        expect(list.items[0]?.type).toBe('message.received');
        expect(list.items[0]?.readAt).toBeNull();
    });

    it('createForAllAdmins() fans out to every owner+admin in the tenant', async () => {
        await svc.createForAllAdmins(TENANT_A, { type: 'booking.received', title: 'New booking' });
        const u1 = await svc.list(TENANT_A, USER_1, {});
        const u2 = await svc.list(TENANT_A, USER_2, {});
        expect(u1.items).toHaveLength(1);
        expect(u2.items).toHaveLength(1);
    });

    it('list() with unread=true filters out read rows', async () => {
        await svc.create({ tenantId: TENANT_A, userId: USER_1, type: 'inspection.created', title: 'A' });
        // Small delay so created_at timestamps differ and desc-ordering is deterministic
        await new Promise(r => setTimeout(r, 1100));
        await svc.create({ tenantId: TENANT_A, userId: USER_1, type: 'inspection.created', title: 'B' });
        const all = await svc.list(TENANT_A, USER_1, {});
        // newest-first: B should be index 0, A index 1
        expect(all.items[0]?.title).toBe('B');
        // mark the newest (B) as read; only A should remain unread
        await svc.markRead(TENANT_A, USER_1, [all.items[0]!.id]);
        const unread = await svc.list(TENANT_A, USER_1, { unread: true });
        expect(unread.items).toHaveLength(1);
        expect(unread.items[0]?.title).toBe('A');
    });

    it('unreadCount() returns the count of unread+non-archived items', async () => {
        await svc.create({ tenantId: TENANT_A, userId: USER_1, type: 'inspection.created', title: 'X' });
        await svc.create({ tenantId: TENANT_A, userId: USER_1, type: 'inspection.created', title: 'Y' });
        expect(await svc.unreadCount(TENANT_A, USER_1)).toBe(2);
        const list = await svc.list(TENANT_A, USER_1, {});
        await svc.markRead(TENANT_A, USER_1, [list.items[0]!.id]);
        expect(await svc.unreadCount(TENANT_A, USER_1)).toBe(1);
    });

    it('markAllRead() zeroes the unread count', async () => {
        await svc.create({ tenantId: TENANT_A, userId: USER_1, type: 'inspection.created', title: 'X' });
        await svc.create({ tenantId: TENANT_A, userId: USER_1, type: 'inspection.created', title: 'Y' });
        await svc.markAllRead(TENANT_A, USER_1);
        expect(await svc.unreadCount(TENANT_A, USER_1)).toBe(0);
    });

    it('archive() removes a notification from the default list', async () => {
        await svc.create({ tenantId: TENANT_A, userId: USER_1, type: 'inspection.created', title: 'X' });
        const list = await svc.list(TENANT_A, USER_1, {});
        const id = list.items[0]!.id;
        await svc.archive(TENANT_A, USER_1, id);
        const after = await svc.list(TENANT_A, USER_1, {});
        expect(after.items).toHaveLength(0);
    });

    it('list() does not leak across tenants', async () => {
        await svc.create({ tenantId: TENANT_B, userId: null, type: 'booking.received', title: 'Other' });
        const a = await svc.list(TENANT_A, USER_1, {});
        expect(a.items).toHaveLength(0);
    });

    it('createForAllAdmins() ignores non-admin users', async () => {
        const inspectorId = '00000000-0000-0000-0000-0000000000b1';
        await testDb.insert(schema.users).values({
            id: inspectorId, tenantId: TENANT_A, email: 'i@a.com', name: 'I',
            passwordHash: 'x', role: 'inspector', createdAt: new Date(),
        });
        await svc.createForAllAdmins(TENANT_A, { type: 'booking.received', title: 'B' });
        const insList = await svc.list(TENANT_A, inspectorId, {});
        expect(insList.items).toHaveLength(0);
    });
});
