/**
 * `joinTeam` enforces the seat cap at ACCEPT time, not only at invite time.
 *
 * The invite route is guarded by `requireSeatAvailable`, and that guard runs
 * once per invite against the count of ACTIVE members. Pending invites hold no
 * seat. So a workspace with one seat left passes the guard for every invite an
 * owner sends, and then admits every one of those people when they accept —
 * the cap is checked N times against a number that has not moved yet, and
 * never checked at the moment it actually moves.
 *
 * The check therefore has to live where the seat is taken. Both `joinTeam`
 * branches take one: the insert obviously, and the REACTIVATION branch too,
 * because `getSeatUsage` counts `deleted_at IS NULL` and clearing `deletedAt`
 * is exactly what makes the row countable again.
 *
 * Enforcement is passed in rather than decided here: a self-hosted deployment
 * has a `max_users` column with a default in it and no billing behind it, so
 * "always check" would cap standalone installs at the schema default. The
 * parameter is REQUIRED, not optional — a seat guard a caller can forget to
 * pass is the guard this file exists to add.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb, setupSchema } from '../db';
import { users, tenantInvites, tenants, tenantConfigs } from '../../../server/lib/db/schema';
import { eq } from 'drizzle-orm';
import { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { withBatch } from '../helpers/d1-binding';
import { AuthService } from '../../../server/services/auth.service';
import { SEAT_QUOTA_UNENFORCED } from '../../../server/features/seat-quota';
import { LegalVersionService } from '../../../server/services/legal-version.service';
import { AppError, ErrorCode } from '../../../server/lib/errors';

const ENFORCED = { enforce: true, billingPortalUrl: 'https://portal.example/billing' } as const;

describe('joinTeam seat guard', () => {
    let auth: AuthService;
    let testDb: BetterSQLite3Database<typeof schema>;
    let sqlite: any;

    beforeEach(async () => {
        const setup = createTestDb();
        testDb = setup.db;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);
        (mockDrizzle as any).mockReturnValue(withBatch(testDb, sqlite));

        await testDb.insert(tenants).values({ id: 't1', slug: 'test', maxUsers: 2, createdAt: new Date() });
        await testDb.insert(tenantConfigs).values({ tenantId: 't1', companyName: 'Test Tenant', updatedAt: new Date() });
        // A tenant with nothing published has nothing to accept and `joinTeam`
        // refuses for that reason instead — which would hide every assertion
        // below behind the wrong error.
        const legal = new LegalVersionService(testDb as never);
        await legal.recordPublish({ tenantId: 't1', doc: 'terms', body: 'Terms.', timezone: 'UTC' });
        await legal.recordPublish({ tenantId: 't1', doc: 'privacy', body: 'Privacy.', timezone: 'UTC' });

        auth = new AuthService({} as any);
    });

    afterEach(() => {
        sqlite.close();
        vi.clearAllMocks();
    });

    async function seedMember(id: string, opts: { deleted?: boolean } = {}) {
        await testDb.insert(users).values({
            id,
            tenantId: 't1',
            email: `${id}@example.com`,
            passwordHash: 'x',
            role: 'inspector',
            createdAt: new Date(),
            ...(opts.deleted ? { deletedAt: new Date() } : {}),
        });
    }

    async function seedInvite(token: string, email: string) {
        await testDb.insert(tenantInvites).values({
            id: token, tenantId: 't1', email, role: 'inspector',
            status: 'pending', expiresAt: new Date(Date.now() + 1_000_000), invitedBy: 'u1',
        } as any);
    }

    it('refuses the accept when the workspace is already at its cap', async () => {
        await seedMember('u1');
        await seedMember('u2');           // max_users = 2, both active → full
        await seedInvite('tok-full', 'third@example.com');

        const err = await auth.joinTeam('tok-full', 'password123', { seatQuota: ENFORCED })
            .then(() => null, (e: unknown) => e);

        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe(ErrorCode.SEAT_LIMIT_REACHED);
        expect((err as AppError).details).toMatchObject({
            used: 2, max: 2, billingPortalUrl: 'https://portal.example/billing',
        });
    });

    it('creates no account and does not burn the invite when it refuses', async () => {
        await seedMember('u1');
        await seedMember('u2');
        await seedInvite('tok-intact', 'third@example.com');

        await expect(auth.joinTeam('tok-intact', 'password123', { seatQuota: ENFORCED })).rejects.toThrow();

        const created = await testDb.select().from(users).where(eq(users.email, 'third@example.com')).get();
        expect(created).toBeUndefined();
        // A refused join must leave the token usable once a seat is freed.
        const invite = await testDb.select().from(tenantInvites).where(eq(tenantInvites.id, 'tok-intact')).get();
        expect(invite?.status).toBe('pending');
    });

    it('refuses a REACTIVATION at the cap — clearing deleted_at takes a seat too', async () => {
        await seedMember('u1');
        await seedMember('u2');
        await seedMember('gone', { deleted: true });   // not counted while soft-deleted
        await seedInvite('tok-react', 'gone@example.com');

        await expect(auth.joinTeam('tok-react', 'password123', { seatQuota: ENFORCED }))
            .rejects.toMatchObject({ code: ErrorCode.SEAT_LIMIT_REACHED });

        const row = await testDb.select().from(users).where(eq(users.id, 'gone')).get();
        expect(row?.deletedAt).not.toBeNull();
    });

    it('refuses when ANOTHER outstanding invitation is holding the last seat', async () => {
        await seedMember('u1');                             // max_users = 2
        await seedInvite('tok-other', 'other@example.com');  // holds the second
        await seedInvite('tok-mine', 'mine@example.com');

        const err = await auth.joinTeam('tok-mine', 'password123', { seatQuota: ENFORCED })
            .then(() => null, (e: unknown) => e);

        // Two seats are held by ONE member row. A count of member rows would
        // read 1 here and admit the join, taking the workspace to three people
        // on a two-seat plan the moment the other invitation is accepted.
        expect((err as AppError).code).toBe(ErrorCode.SEAT_LIMIT_REACHED);
        expect((err as AppError).details).toMatchObject({ used: 2, max: 2 });
        const created = await testDb.select().from(users).where(eq(users.email, 'mine@example.com')).get();
        expect(created).toBeUndefined();
    });

    it('does not count the invitation being redeemed against its own acceptance', async () => {
        await seedMember('u1');                             // max_users = 2
        await seedInvite('tok-self', 'self@example.com');   // the second seat, held by THIS invite

        // The invite is itself outstanding, so a check that failed to exclude it
        // would see 2 held against a cap of 2 and refuse every last legitimate
        // acceptance — the previous test is the positive control that says the
        // exclusion is one invitation wide and not a disabled check.
        await expect(auth.joinTeam('tok-self', 'password123', { seatQuota: ENFORCED }))
            .resolves.toBeTruthy();
    });

    it('admits the join when a seat is free', async () => {
        await seedMember('u1');
        await seedInvite('tok-room', 'second@example.com');

        const joined = await auth.joinTeam('tok-room', 'password123', { seatQuota: ENFORCED });

        expect(joined.email).toBe('second@example.com');
        const created = await testDb.select().from(users).where(eq(users.email, 'second@example.com')).get();
        expect(created).toBeDefined();
    });

    it('admits a join that frees-then-fills — a soft-deleted member does not hold a seat', async () => {
        await seedMember('u1');
        await seedMember('u2', { deleted: true });     // seat released by removeMember
        await seedInvite('tok-freed', 'fresh@example.com');

        await expect(auth.joinTeam('tok-freed', 'password123', { seatQuota: ENFORCED })).resolves.toBeTruthy();
    });

    it('does not check seats at all when the deployment does not enforce them', async () => {
        await seedMember('u1');
        await seedMember('u2');
        await seedMember('u3');           // already over the stored cap
        await seedInvite('tok-standalone', 'fourth@example.com');

        await expect(auth.joinTeam('tok-standalone', 'password123', { seatQuota: SEAT_QUOTA_UNENFORCED }))
            .resolves.toBeTruthy();
    });

    it('treats max_users = 0 as unlimited, matching getSeatUsage', async () => {
        await testDb.update(tenants).set({ maxUsers: 0 }).where(eq(tenants.id, 't1'));
        await seedMember('u1');
        await seedMember('u2');
        await seedMember('u3');
        await seedInvite('tok-unlimited', 'many@example.com');

        await expect(auth.joinTeam('tok-unlimited', 'password123', { seatQuota: ENFORCED }))
            .resolves.toBeTruthy();
    });

    it('still carries the display name through the options object', async () => {
        await seedInvite('tok-name', 'named@example.com');

        await auth.joinTeam('tok-name', 'password123', { name: 'Jamie Rivera', seatQuota: ENFORCED });

        const row = await testDb.select().from(users).where(eq(users.email, 'named@example.com')).get();
        expect(row?.name).toBe('Jamie Rivera');
    });
});
