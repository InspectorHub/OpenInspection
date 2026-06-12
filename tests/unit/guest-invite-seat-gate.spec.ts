/**
 * Task 7 — TDD: enforceSeatQuota flag on GuestInviteService.claim().
 *
 * Verifies that the seat-quota check is only applied when
 * ctx.enforceSeatQuota === true (SaaS), and skipped entirely when it
 * is false (standalone / self-hosted).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GuestInviteService } from '../../server/services/guest-invite.service';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-000000000088';

async function seedTenant(testDb: BetterSQLite3Database<typeof schema>) {
    await testDb.insert(schema.tenants).values({
        id: TENANT, name: 'SeatGateCo', slug: 'seat-gate-co', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
}

async function seedPermanentUser(testDb: BetterSQLite3Database<typeof schema>, id: string, email: string) {
    await testDb.insert(schema.users).values({
        id,
        tenantId: TENANT,
        email,
        passwordHash: 'hash',
        name: 'Existing User',
        role: 'lead',
        // expiresAt null => permanent member, always counts against seat quota
        createdAt: new Date(),
    });
}

describe('GuestInviteService — enforceSeatQuota gate (Task 7)', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let svc: GuestInviteService;

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        await seedTenant(testDb);
        svc = new GuestInviteService({} as D1Database);
    });

    it('rejects with over_quota when enforceSeatQuota=true and at cap', async () => {
        // Seed one permanent user — tenant is already at maxUsers=1.
        await seedPermanentUser(testDb, 'u-existing-1', 'existing1@test.com');

        const minted = await svc.mint(TENANT, { role: 'lead', durationSeconds: 86_400, createdBy: 'u-admin' });
        const result = await svc.claim(
            minted.token,
            { name: 'Guest A', email: 'guesta@test.com', password: 'pw01234567' },
            { maxUsers: 1, enforceSeatQuota: true },
        );
        expect(result.kind).toBe('over_quota');
    });

    it('allows the claim when enforceSeatQuota=false even at cap (standalone)', async () => {
        // Same setup: one permanent user, tenant at maxUsers=1.
        await seedPermanentUser(testDb, 'u-existing-2', 'existing2@test.com');

        // Distinct unclaimed token and distinct email to avoid uniqueness collisions.
        const minted2 = await svc.mint(TENANT, { role: 'lead', durationSeconds: 86_400, createdBy: 'u-admin' });
        const result = await svc.claim(
            minted2.token,
            { name: 'Guest B', email: 'guestb@test.com', password: 'pw01234567' },
            { maxUsers: 1, enforceSeatQuota: false },
        );
        expect(result.kind).not.toBe('over_quota');
        // Should succeed (standalone is genuinely unlimited).
        expect(result.kind).toBe('ok');
    });
});
