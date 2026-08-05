/**
 * Standalone login row selection must be tenant-scoped: a same-email global
 * agent (`users.tenant_id IS NULL`, `role='agent'`) must never be the row
 * authenticated by `/login`. See spec login-email-ambiguity.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AuthService } from '../../../server/services/auth.service';
import { MockKV } from '../mocks';
import { createTestDb, setupSchema } from '../db';
import { users, tenants } from '../../../server/lib/db/schema';
import { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';

// Mock the drizzle-orm/d1 module to return our in-memory SQLite DB — mirrors
// the harness in auth.service.spec.ts. AuthService.getDrizzle() calls
// drizzle(this.db), so the mock returns the test db regardless of the ctor's
// first arg.
vi.mock('drizzle-orm/d1', () => ({
    drizzle: vi.fn(),
}));

import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = 't1';

describe('AuthService.findLoginUser — tenant-scoped, fail-closed row selection', () => {
    let authService: AuthService;
    let mockKV: MockKV;
    let testDb: BetterSQLite3Database<typeof schema>;
    let sqlite: any;

    beforeEach(async () => {
        const setup = createTestDb();
        testDb = setup.db;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);

        (mockDrizzle as any).mockReturnValue(testDb);
        mockKV = new MockKV();

        await testDb.insert(tenants).values({
            id: TENANT,
            name: 'Test Tenant',
            slug: 'test',
            createdAt: new Date(),
        });

        // Same email on two rows: a tenant-scoped inspector, and a global
        // (NULL-tenant) agent account. tenantId is nullable in the schema
        // (Agent Accounts A1), so this seeds cleanly without a NOT NULL
        // constraint violation.
        await testDb.insert(users).values({
            id: 'u_insp',
            tenantId: TENANT,
            email: 'dup@x.com',
            passwordHash: 'H',
            role: 'inspector',
            createdAt: new Date(),
        });
        await testDb.insert(users).values({
            id: 'u_agent',
            tenantId: null,
            email: 'dup@x.com',
            passwordHash: 'H',
            role: 'agent',
            createdAt: new Date(),
        } as any);

        authService = new AuthService({} as any, mockKV as any);
    });

    afterEach(() => {
        sqlite.close();
        vi.clearAllMocks();
    });

    it('selects the tenant inspector, never the global agent', async () => {
        const user = await authService.findLoginUser('dup@x.com', TENANT);
        expect(user?.id).toBe('u_insp');
    });

    it('returns null when only a global (NULL-tenant) agent matches', async () => {
        // Seed a lone global agent under a DIFFERENT email so the tenant-scoped
        // query for it has nothing to match.
        await testDb.insert(users).values({
            id: 'u_agent_only',
            tenantId: null,
            email: 'only-agent@x.com',
            passwordHash: 'H',
            role: 'agent',
            createdAt: new Date(),
        } as any);

        const user = await authService.findLoginUser('only-agent@x.com', TENANT);
        expect(user).toBeNull();
    });
});
