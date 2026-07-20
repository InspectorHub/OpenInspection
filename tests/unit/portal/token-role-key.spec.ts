import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { PortalAccessService } from '../../../server/services/portal-access.service';
import { seedRoleProfiles } from '../../../server/services/seed/seed-role-profiles';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

// The `role` column on inspection_access_tokens is a Drizzle TYPE-LAYER
// constraint only (SQLite stores plain TEXT) — widening it to accept any
// tenant role-profile KEY (not just the legacy client/co_client/agent enum)
// requires no migration. See spec 2026-07-18 Plan 1A Task 10.
vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-0000000000c2';
const INSPECTION = '11111111-1111-1111-1111-1111111111c2';
const JWT = 'unit-test-jwt-secret';

describe('PortalAccessService — token role references a role-profile key', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let svc: PortalAccessService;

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        await testDb.insert(schema.tenants).values({
            id: TENANT, name: 'Acme', slug: 'acme-role-key', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await seedRoleProfiles(testDb, TENANT, new Date(1));
        svc = new PortalAccessService({} as D1Database, { jwtSecret: JWT });
    });

    it('issueToken accepts a non-legacy role-profile key (buyer_agent) and persists it', async () => {
        await svc.issueToken({ tenantId: TENANT, inspectionId: INSPECTION, recipientEmail: 'agent@x.com', role: 'buyer_agent' });
        const row = await testDb.select().from(schema.inspectionAccessTokens)
            .where(eq(schema.inspectionAccessTokens.recipientEmail, 'agent@x.com')).get();
        expect(row?.role).toBe('buyer_agent');
    });

    it('issueToken rejects an unknown role key for the tenant', async () => {
        await expect(svc.issueToken({ tenantId: TENANT, inspectionId: INSPECTION, recipientEmail: 'nope@x.com', role: 'nope' }))
            .rejects.toThrow(/unknown role/i);
    });

    it('issueToken still accepts the default client role', async () => {
        await svc.issueToken({ tenantId: TENANT, inspectionId: INSPECTION, recipientEmail: 'client@x.com', role: 'client' });
        const row = await testDb.select().from(schema.inspectionAccessTokens)
            .where(eq(schema.inspectionAccessTokens.recipientEmail, 'client@x.com')).get();
        expect(row?.role).toBe('client');
    });

    it('issueToken still defaults to client when no role is provided', async () => {
        await svc.issueToken({ tenantId: TENANT, inspectionId: INSPECTION, recipientEmail: 'default@x.com' });
        const row = await testDb.select().from(schema.inspectionAccessTokens)
            .where(eq(schema.inspectionAccessTokens.recipientEmail, 'default@x.com')).get();
        expect(row?.role).toBe('client');
    });
});
