/**
 * Task 8a — member removal is soft-delete (deactivate) with re-invite
 * reactivation.
 *
 * `TeamService.removeMember` used to hard-delete the `users` row. That broke
 * under D1 FK enforcement once the member had authored any inspections
 * (`inspections.inspector_id` references `users.id`) and orphaned report
 * attribution otherwise. It now soft-deletes via `users.deletedAt`, which:
 *   - keeps inspection attribution intact (pin the FK regression below),
 *   - is excluded from `getSeatUsage` and the team list,
 *   - is rejected by login/credential validation,
 *   - is REACTIVATED (not re-inserted) on a subsequent re-invite + accept.
 *
 * It also writes a `pwchanged:{userId}` KV marker (same pattern as
 * AuthService.writeInvalidation) so the removed member's outstanding JWT is
 * rejected immediately instead of surviving up to its 24h expiry —
 * jwtAuthMiddleware checks this key per request but never re-reads the user
 * row.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { TeamService } from '../../server/services/team.service';
import { AuthService } from '../../server/services/auth.service';
import { getSeatUsage } from '../../server/features/seat-quota/usage';
import { MockKV } from './mocks';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

// Route every drizzle(d1) call inside the services under test to the
// in-memory SQLite test DB (the established pattern in this suite).
vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-0000000000d1';
const ADMIN = '11111111-1111-1111-1111-1111111111d1';
const MEMBER = '22222222-2222-2222-2222-2222222222d1';
const MEMBER_EMAIL = 'removed@acme.test';

describe('TeamService.removeMember — soft-delete (Task 8a)', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let sqlite: InstanceType<typeof import('better-sqlite3')>;
    let kv: MockKV;

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        sqlite = fix.sqlite;
        await setupSchema(sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        kv = new MockKV();

        await testDb.insert(schema.tenants).values({
            id: TENANT, name: 'Acme', slug: 'acme-d1', status: 'active',
            deploymentMode: 'shared', tier: 'free', maxUsers: 5, createdAt: new Date(),
        });
        await testDb.insert(schema.users).values({
            id: ADMIN, tenantId: TENANT, email: 'admin@acme.test',
            passwordHash: 'x', role: 'admin', createdAt: new Date(),
        });
        await testDb.insert(schema.users).values({
            id: MEMBER, tenantId: TENANT, email: MEMBER_EMAIL,
            passwordHash: 'hash', role: 'inspector', createdAt: new Date(),
        });
    });

    it('leaves the row with deletedAt set instead of deleting it', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const team = new TeamService({} as any, undefined, kv as any);
        await team.removeMember(TENANT, MEMBER, ADMIN);

        const row = await testDb.select().from(schema.users).where(eq(schema.users.id, MEMBER)).get();
        expect(row).toBeDefined();
        expect(row!.deletedAt).not.toBeNull();
    });

    it('removing a member WITH inspections succeeds and keeps attribution intact (FK regression)', async () => {
        await testDb.insert(schema.inspections).values({
            id: 'insp-1', tenantId: TENANT, inspectorId: MEMBER, propertyAddress: '1 Main St',
            date: '2026-07-01', status: 'requested', paymentStatus: 'unpaid', price: 0,
            agreementRequired: false, paymentRequired: false, createdAt: new Date(),
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const team = new TeamService({} as any, undefined, kv as any);
        // The old hard-delete would violate the inspections.inspector_id FK
        // (baseline migration + FK-ON by the time all migrations replay) —
        // this must NOT throw.
        await expect(team.removeMember(TENANT, MEMBER, ADMIN)).resolves.toBeDefined();

        const inspection = await testDb.select().from(schema.inspections).where(eq(schema.inspections.id, 'insp-1')).get();
        expect(inspection?.inspectorId).toBe(MEMBER);
        const row = await testDb.select().from(schema.users).where(eq(schema.users.id, MEMBER)).get();
        expect(row).toBeDefined();
        expect(row!.deletedAt).not.toBeNull();
    });

    it('excludes the removed member from getSeatUsage', async () => {
        const before = await getSeatUsage(TENANT, {} as never);
        expect(before.used).toBe(2); // admin + member

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const team = new TeamService({} as any, undefined, kv as any);
        await team.removeMember(TENANT, MEMBER, ADMIN);

        const after = await getSeatUsage(TENANT, {} as never);
        expect(after.used).toBe(1); // admin only — the seat is freed
    });

    it('excludes the removed member from the team list', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const team = new TeamService({} as any, undefined, kv as any);
        await team.removeMember(TENANT, MEMBER, ADMIN);

        const { activeUsers } = await team.getMembers(TENANT);
        expect(activeUsers.map(u => u.id)).toEqual([ADMIN]);
    });

    it('writes a pwchanged:{userId} KV invalidation marker (mandatory addendum)', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const team = new TeamService({} as any, undefined, kv as any);
        await team.removeMember(TENANT, MEMBER, ADMIN);

        expect(kv.put).toHaveBeenCalledWith(
            `pwchanged:${MEMBER}`,
            expect.any(String),
            expect.objectContaining({ expirationTtl: 90000 }),
        );
    });

    it('login/credential validation rejects a soft-deleted user', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const auth = new AuthService({} as any, kv as any);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const team = new TeamService({} as any, undefined, kv as any);
        await team.removeMember(TENANT, MEMBER, ADMIN);

        // The removed member's password hash is bogus ('hash'), but the
        // point is the row must be excluded from the lookup entirely —
        // validateCredentials should reject with the same generic error it
        // uses for an unknown email, never reach a password comparison that
        // could succeed.
        await expect(auth.validateCredentials(MEMBER_EMAIL, 'whatever'))
            .rejects.toThrow('Invalid email or password');
    });

    it('re-invite of the same email clears deletedAt, applies the new role, and seat usage counts them again', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const team = new TeamService({} as any, undefined, kv as any);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const auth = new AuthService({} as any, kv as any);

        await team.removeMember(TENANT, MEMBER, ADMIN);
        expect((await getSeatUsage(TENANT, {} as never)).used).toBe(1);

        // createInvite must NOT be blocked by the soft-deleted row.
        const invite = await team.createInvite({
            tenantId: TENANT,
            email: MEMBER_EMAIL,
            role: 'admin',
        });

        await auth.joinTeam(invite.token, 'new-password-123');

        const row = await testDb.select().from(schema.users).where(eq(schema.users.email, MEMBER_EMAIL)).get();
        expect(row).toBeDefined();
        expect(row!.id).toBe(MEMBER); // reactivated in place, not a fresh row
        expect(row!.deletedAt).toBeNull();
        expect(row!.role).toBe('admin');

        expect((await getSeatUsage(TENANT, {} as never)).used).toBe(2);

        const { activeUsers } = await team.getMembers(TENANT);
        expect(activeUsers.map(u => u.id).sort()).toEqual([ADMIN, MEMBER].sort());
    });
});
