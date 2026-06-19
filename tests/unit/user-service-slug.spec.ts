import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { UserService } from '../../server/services/user.service';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

// Mock drizzle-orm/d1 to return our in-memory better-sqlite3 db so the service
// can be exercised exactly as it would on D1 in production.
vi.mock('drizzle-orm/d1', () => ({
    drizzle: vi.fn(),
}));

import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-0000000000aa';
const OTHER_TENANT = '00000000-0000-0000-0000-0000000000bb';

describe('UserService — slug', () => {
    let svc: UserService;
    let testDb: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        sqlite = fixture.sqlite;
        await setupSchema(sqlite);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);

        await testDb.insert(schema.tenants).values([
            { id: TENANT, name: 'Acme', slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
            { id: OTHER_TENANT, name: 'Other', slug: 'other', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        ]);

        svc = new UserService({} as unknown as D1Database);
    });

    afterEach(() => {
        sqlite.close();
        vi.clearAllMocks();
    });

    it('checkSlug returns available for fresh slug', async () => {
        const result = await svc.checkSlug(TENANT, 'jane');
        expect(result.available).toBe(true);
    });

    it('checkSlug rejects reserved slugs', async () => {
        // 'admin' is in the reserved-slug seed list.
        const result = await svc.checkSlug(TENANT, 'admin');
        expect(result.available).toBe(false);
        expect(result.reason).toBe('reserved');
    });

    it('checkSlug returns taken when another user in same tenant has it', async () => {
        await testDb.insert(schema.users).values({
            id: 'u1',
            tenantId: TENANT,
            email: 'u1@a.com',
            passwordHash: 'x',
            role: 'inspector',
            name: 'U1',
            slug: 'taken',
            createdAt: new Date(),
        });
        const result = await svc.checkSlug(TENANT, 'taken');
        expect(result.available).toBe(false);
        expect(result.reason).toBe('taken');
        expect(result.suggestions).toBeDefined();
        expect(result.suggestions!.length).toBeGreaterThan(0);
    });

    it('checkSlug allows same slug across DIFFERENT tenants (per-tenant uniqueness)', async () => {
        await testDb.insert(schema.users).values({
            id: 'u-other',
            tenantId: OTHER_TENANT,
            email: 'u@other.com',
            passwordHash: 'x',
            role: 'inspector',
            name: 'Other',
            slug: 'shared',
            createdAt: new Date(),
        });
        const result = await svc.checkSlug(TENANT, 'shared');
        expect(result.available).toBe(true);
    });

    it('checkSlug excludes the current user when excludeUserId is supplied', async () => {
        await testDb.insert(schema.users).values({
            id: 'u-self',
            tenantId: TENANT,
            email: 'self@a.com',
            passwordHash: 'x',
            role: 'inspector',
            name: 'Self',
            slug: 'me',
            createdAt: new Date(),
        });
        const result = await svc.checkSlug(TENANT, 'me', 'u-self');
        expect(result.available).toBe(true);
    });

    it('setSlug persists slug for the right user + tenant', async () => {
        await testDb.insert(schema.users).values({
            id: 'u1',
            tenantId: TENANT,
            email: 'u1@a.com',
            passwordHash: 'x',
            role: 'inspector',
            name: 'U1',
            createdAt: new Date(),
        });
        await svc.setSlug('u1', TENANT, 'john');
        const row = await testDb.select().from(schema.users).where(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (await import('drizzle-orm')).eq(schema.users.id, 'u1') as any,
        ).get();
        expect(row?.slug).toBe('john');
    });

    it('setSlug throws when slug is reserved', async () => {
        await testDb.insert(schema.users).values({
            id: 'u1',
            tenantId: TENANT,
            email: 'u1@a.com',
            passwordHash: 'x',
            role: 'inspector',
            name: 'U1',
            createdAt: new Date(),
        });
        await expect(svc.setSlug('u1', TENANT, 'admin')).rejects.toThrow(/reserved/);
    });

    it('findBySlug returns user', async () => {
        await testDb.insert(schema.users).values({
            id: 'u1',
            tenantId: TENANT,
            email: 'u1@a.com',
            passwordHash: 'x',
            role: 'inspector',
            name: 'U1',
            slug: 'john',
            createdAt: new Date(),
        });
        const user = await svc.findBySlug(TENANT, 'john');
        expect(user?.id).toBe('u1');
    });

    it('findBySlug enforces tenant scope', async () => {
        await testDb.insert(schema.users).values({
            id: 'u1',
            tenantId: OTHER_TENANT,
            email: 'u1@b.com',
            passwordHash: 'x',
            role: 'inspector',
            name: 'U1',
            slug: 'john',
            createdAt: new Date(),
        });
        const user = await svc.findBySlug(TENANT, 'john');
        expect(user).toBeNull();
    });

    it('suggestAlternatives returns the requested count of unique candidates', () => {
        const out = svc.suggestAlternatives('john', 3);
        expect(out).toHaveLength(3);
        expect(new Set(out).size).toBe(3);
        for (const candidate of out) {
            expect(candidate.startsWith('john-')).toBe(true);
        }
    });
});
