import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { UserService } from '../../src/services/user.service';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../src/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-000000000001';
const USER = '00000000-0000-0000-0000-000000000010';

describe('UserService.getProfileBySlug — Sprint C-1', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];
    let svc: UserService;

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        sqlite = fixture.sqlite;
        await setupSchema(sqlite);

        await testDb.insert(schema.tenants).values([
            { id: TENANT, name: 'Acme', subdomain: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        ]);
        await testDb.insert(schema.users).values([
            {
                id: USER,
                tenantId: TENANT,
                email: 'mike@test.com',
                name: 'Mike Reynolds',
                role: 'inspector',
                slug: 'mike',
                phone: '(303) 555-0142',
                licenseNumber: 'TX-9001',
                bio: 'Texas-licensed home inspector since 2018.',
                photoUrl: 'https://r2.example/photos/mike.jpg',
                serviceAreas: '[{"city":"Austin","state":"TX","zip":"78701"},{"city":"Round Rock","state":"TX","zip":"78664"}]',
                passwordHash: 'x',
                createdAt: new Date(),
            },
        ]);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        svc = new UserService({} as unknown as D1Database);
    });

    afterEach(() => {
        sqlite.close();
        vi.clearAllMocks();
    });

    it('returns full profile with parsed service areas', async () => {
        const profile = await svc.getProfileBySlug(TENANT, 'mike');
        expect(profile?.name).toBe('Mike Reynolds');
        expect(profile?.bio).toContain('2018');
        expect(profile?.photoUrl).toContain('mike.jpg');
        expect(profile?.licenseNumber).toBe('TX-9001');
        expect(profile?.email).toBe('mike@test.com');
        expect(profile?.phone).toBe('(303) 555-0142');
        expect(profile?.slug).toBe('mike');
        expect(profile?.serviceAreas).toEqual([
            { city: 'Austin', state: 'TX', zip: '78701' },
            { city: 'Round Rock', state: 'TX', zip: '78664' },
        ]);
    });

    it('returns null for unknown slug', async () => {
        const profile = await svc.getProfileBySlug(TENANT, 'nonexistent');
        expect(profile).toBeNull();
    });

    it('handles malformed service_areas JSON gracefully', async () => {
        await testDb.update(schema.users).set({ serviceAreas: 'not-json' }).where(eq(schema.users.id, USER));
        const profile = await svc.getProfileBySlug(TENANT, 'mike');
        expect(profile?.serviceAreas).toEqual([]);
    });

    it('returns empty array when service_areas is null', async () => {
        await testDb.update(schema.users).set({ serviceAreas: null }).where(eq(schema.users.id, USER));
        const profile = await svc.getProfileBySlug(TENANT, 'mike');
        expect(profile?.serviceAreas).toEqual([]);
    });

    it('enforces tenant scope (different tenant cannot read profile)', async () => {
        const OTHER_TENANT = '00000000-0000-0000-0000-000000000099';
        await testDb.insert(schema.tenants).values({ id: OTHER_TENANT, name: 'Other', subdomain: 'other', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() });
        const profile = await svc.getProfileBySlug(OTHER_TENANT, 'mike');
        expect(profile).toBeNull();
    });
});
