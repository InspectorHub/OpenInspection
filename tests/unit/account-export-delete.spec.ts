/**
 * Account export + soft-delete service tests.
 *
 * exportAccount: returns the calling user's row + agent_tenant_links + the
 * inspections they ran. Memberships + inspections may be empty arrays for a
 * fresh account.
 *
 * softDeleteAccount: rejects when confirmEmail does not match, stamps
 * users.deletedAt when it does.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { exportAccount, softDeleteAccount } from '../../server/services/account.service';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

const TENANT = '00000000-0000-0000-0000-000000000001';
const TENANT_B = '00000000-0000-0000-0000-000000000002';
const USER_ID = '00000000-0000-0000-0000-0000000000a1';
const AGENT_ID = '00000000-0000-0000-0000-0000000000a2';

describe('exportAccount', () => {
    let testDb: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        await testDb.insert(schema.tenants).values([
            { id: TENANT,   name: 'T1', slug: 't1', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
            { id: TENANT_B, name: 'T2', slug: 't2', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        ]);
        await testDb.insert(schema.users).values({
            id: USER_ID, tenantId: TENANT, email: 'a@x.com', passwordHash: 'x', role: 'admin', createdAt: new Date(),
        });
    });

    it('returns identity + empty membership/inspection arrays when no data', async () => {
        const result = await exportAccount(testDb as any, USER_ID);
        expect((result.identity as Record<string, unknown>).id).toBe(USER_ID);
        expect(result.memberships).toEqual([]);
        expect(result.inspections).toEqual([]);
        expect(result.exportedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
    });

    it('returns agent_tenant_links memberships scoped to this user', async () => {
        await testDb.insert(schema.users).values({
            id: AGENT_ID, tenantId: TENANT, email: 'agent@x.com', passwordHash: 'x', role: 'agent', createdAt: new Date(),
        });
        await testDb.insert(schema.agentTenantLinks).values({
            id: 'link-1', agentUserId: USER_ID, tenantId: TENANT_B, status: 'active', createdAt: new Date(),
        });
        // unrelated link for another agent — must NOT appear
        await testDb.insert(schema.agentTenantLinks).values({
            id: 'link-2', agentUserId: AGENT_ID, tenantId: TENANT, status: 'active', createdAt: new Date(),
        });
        const result = await exportAccount(testDb as any, USER_ID);
        expect(result.memberships).toHaveLength(1);
        expect((result.memberships[0] as any).id).toBe('link-1');
    });

    it('returns inspections the user authored as inspector', async () => {
        await testDb.insert(schema.inspections).values({
            id: 'i-1', tenantId: TENANT, inspectorId: USER_ID, propertyAddress: '1 St',
            date: '2026-06-01', status: 'requested', paymentStatus: 'unpaid', price: 0,
            agreementRequired: false, paymentRequired: false, createdAt: new Date(),
        });
        // unrelated inspection — different inspector
        await testDb.insert(schema.inspections).values({
            id: 'i-2', tenantId: TENANT, propertyAddress: '2 St',
            date: '2026-06-02', status: 'requested', paymentStatus: 'unpaid', price: 0,
            agreementRequired: false, paymentRequired: false, createdAt: new Date(),
        });
        const result = await exportAccount(testDb as any, USER_ID);
        expect(result.inspections).toHaveLength(1);
        expect((result.inspections[0] as any).id).toBe('i-1');
    });
});

describe('softDeleteAccount', () => {
    let testDb: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        await testDb.insert(schema.tenants).values({
            id: TENANT, name: 'T1', slug: 't1', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await testDb.insert(schema.users).values({
            id: USER_ID, tenantId: TENANT, email: 'a@x.com', passwordHash: 'x', role: 'admin', createdAt: new Date(),
        });
    });

    it('marks deletedAt and returns identityId on email match', async () => {
        const result = await softDeleteAccount(testDb as any, USER_ID, 'a@x.com');
        expect(result.identityId).toBe(USER_ID);
        expect(result.deletedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
        const row = await testDb.select().from(schema.users).where(eq(schema.users.id, USER_ID)).get();
        expect(row?.deletedAt).toBeTruthy();
    });

    it('throws when confirmEmail does not match', async () => {
        await expect(softDeleteAccount(testDb as any, USER_ID, 'wrong@x.com'))
            .rejects.toThrow(/email/i);
        const row = await testDb.select().from(schema.users).where(eq(schema.users.id, USER_ID)).get();
        expect(row?.deletedAt).toBeFalsy();
    });

    it('throws when identity does not exist', async () => {
        await expect(softDeleteAccount(testDb as any, 'nonexistent-id', 'a@x.com'))
            .rejects.toThrow(/not found/i);
    });
});
