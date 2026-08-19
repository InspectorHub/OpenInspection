/**
 * Seat usage counts what is HELD, not what has been accepted.
 *
 * An invite that has been sent and not yet accepted has already committed the
 * seat: the person can take it at any moment, and nothing between now and then
 * would notice. Counting only accepted members meant N invites could all be
 * sent against one remaining seat and all be accepted.
 *
 * The expiry condition is load-bearing and not decoration. The invite status
 * column has no expired member and nothing sweeps the table, so an ignored
 * invite stays `pending` forever. Without the date test it would hold a seat
 * for good; with it, the seat comes back after the invite's own lifetime and
 * no scheduled job is needed to release it.
 *
 * `members` is reported alongside `used` because the two numbers answer
 * different questions and one of them is money: a guard reserves against what
 * can still be claimed, while a bill is for people who are actually here.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Database as SqliteDatabase } from 'better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { asD1DrizzleReturn } from '../helpers/test-db';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { getSeatUsage } from '../../../server/features/seat-quota/usage';

const TENANT = '11111111-1111-1111-1111-1111111111a1';
const OTHER = '11111111-1111-1111-1111-1111111111a2';
const FUTURE = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
const PAST = () => new Date(Date.now() - 1000);

describe('getSeatUsage', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: SqliteDatabase;

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        sqlite = fix.sqlite;
        await setupSchema(sqlite);
        vi.mocked(mockDrizzle).mockReturnValue(asD1DrizzleReturn(db));
        await db.insert(schema.tenants).values({
            id: TENANT, slug: 'a', status: 'active', deploymentMode: 'shared',
            tier: 'free', maxUsers: 3, createdAt: new Date(),
        });
    });

    afterEach(() => {
        sqlite.close();
        vi.clearAllMocks();
    });

    async function seedMember(id: string, opts: { deleted?: boolean; tenantId?: string } = {}) {
        await db.insert(schema.users).values({
            id,
            tenantId: opts.tenantId ?? TENANT,
            email: `${id}@example.test`,
            passwordHash: 'x',
            role: 'inspector',
            createdAt: new Date(),
            ...(opts.deleted ? { deletedAt: new Date() } : {}),
        });
    }

    async function seedInvite(
        id: string,
        opts: { status?: 'pending' | 'accepted'; expiresAt?: Date; tenantId?: string } = {},
    ) {
        await db.insert(schema.tenantInvites).values({
            id,
            tenantId: opts.tenantId ?? TENANT,
            email: `${id}@example.test`,
            role: 'inspector',
            status: opts.status ?? 'pending',
            expiresAt: opts.expiresAt ?? FUTURE(),
        });
    }

    it('counts an outstanding invite as a held seat', async () => {
        await seedMember('u1');
        await seedInvite('i1');

        const usage = await getSeatUsage(TENANT, {} as D1Database);

        expect(usage).toEqual({ used: 2, members: 1, max: 3, remaining: 1, pendingInvites: 1 });
    });

    it('positive control: with no invites the held count is the member count', async () => {
        await seedMember('u1');
        await seedMember('u2');

        const usage = await getSeatUsage(TENANT, {} as D1Database);

        expect(usage).toEqual({ used: 2, members: 2, max: 3, remaining: 1, pendingInvites: 0 });
    });

    it('does not count an expired invite', async () => {
        await seedInvite('live');
        await seedInvite('dead', { expiresAt: PAST() });

        const usage = await getSeatUsage(TENANT, {} as D1Database);

        expect(usage.used).toBe(1);
        expect(usage.pendingInvites).toBe(1);
        expect(usage.remaining).toBe(2);
    });

    it('does not count an accepted invite twice', async () => {
        await seedMember('u1');
        await seedInvite('i1', { status: 'accepted' });

        const usage = await getSeatUsage(TENANT, {} as D1Database);

        expect(usage.used).toBe(1);
        expect(usage.members).toBe(1);
        expect(usage.pendingInvites).toBe(0);
    });

    it('does not count a removed member, and does not count their seat as pending either', async () => {
        await seedMember('gone', { deleted: true });

        const usage = await getSeatUsage(TENANT, {} as D1Database);

        expect(usage).toEqual({ used: 0, members: 0, max: 3, remaining: 3, pendingInvites: 0 });
    });

    it('can leave one named invite out of the count', async () => {
        await seedInvite('i1');
        await seedInvite('i2');

        const usage = await getSeatUsage(TENANT, {} as D1Database, { excludeInviteId: 'i1' });

        expect(usage.used).toBe(1);
        expect(usage.pendingInvites).toBe(1);
        // Positive control for the exclusion: the same fixture read without it
        // reports both, so a zero above would be the exclusion working rather
        // than the invite query having stopped returning anything.
        const unfiltered = await getSeatUsage(TENANT, {} as D1Database);
        expect(unfiltered.pendingInvites).toBe(2);
    });

    it('counts invites of THIS tenant only', async () => {
        await db.insert(schema.tenants).values({
            id: OTHER, slug: 'b', status: 'active', deploymentMode: 'shared',
            tier: 'free', maxUsers: 3, createdAt: new Date(),
        });
        await seedInvite('mine');
        await seedInvite('theirs', { tenantId: OTHER });
        await seedMember('theirmember', { tenantId: OTHER });

        const usage = await getSeatUsage(TENANT, {} as D1Database);

        expect(usage).toEqual({ used: 1, members: 0, max: 3, remaining: 2, pendingInvites: 1 });
    });

    it('reports an unlimited tenant as max null with infinite headroom', async () => {
        await db.update(schema.tenants).set({ maxUsers: 0 });
        await seedInvite('i1');

        const usage = await getSeatUsage(TENANT, {} as D1Database);

        expect(usage.max).toBeNull();
        expect(usage.remaining).toBe(Number.POSITIVE_INFINITY);
        expect(usage.pendingInvites).toBe(1);
    });
});
