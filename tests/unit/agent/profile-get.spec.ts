/**
 * Spec 3 Task 4b — getProfile() reader backing GET /api/agent/profile.
 * Harness mirrors tests/unit/usage/plan-quota.spec.ts: `drizzle-orm/d1`'s
 * `drizzle()` is mocked to return the real better-sqlite3-backed Drizzle
 * instance (so `getProfile`'s internal `drizzle(rawDb)` call operates on
 * real seeded data), and `toRawD1` supplies a D1Database-shaped value for
 * the (ignored, mocked-away) `rawDb` parameter.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb, setupSchema, toRawD1 } from '../db';
import * as schema from '../../../server/lib/db/schema';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
// eslint-disable-next-line import/order
import { getProfile, updateProfile } from '../../../server/services/agent/profile';
import { eq } from 'drizzle-orm';

describe('getProfile', () => {
    let f: ReturnType<typeof createTestDb>;
    let rawDb: D1Database;

    beforeEach(async () => {
        f = createTestDb();
        await setupSchema(f.sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(f.db);
        rawDb = toRawD1(f.sqlite);

        await f.db.insert(schema.users).values({
            id: 'ag1', tenantId: null, email: 'jane@x.com', role: 'agent', name: 'Jane',
            slug: 'jane', notifyOnReferral: true, notifyOnReport: true, notifyOnPaid: false,
            passwordHash: 'H', createdAt: new Date(),
        } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    });

    afterEach(() => f.sqlite.close());

    it('returns the agent profile shape', async () => {
        const p = await getProfile(rawDb, 'ag1');
        expect(p).toEqual({
            name: 'Jane', email: 'jane@x.com', slug: 'jane',
            notifyOnReferral: true, notifyOnReport: true, notifyOnPaid: false,
            timezone: null,
        });
    });

    it('unknown id throws NotFound', async () => {
        await expect(getProfile(rawDb, 'ghost')).rejects.toMatchObject({ status: 404 });
    });

    // Personal display-timezone override (Spec 3 follow-up).
    it('persists a valid IANA timezone and reflects it on read', async () => {
        await updateProfile(rawDb, 'ag1', { timezone: 'America/Chicago' });
        expect((await getProfile(rawDb, 'ag1')).timezone).toBe('America/Chicago');
    });

    it('an empty-string timezone clears the override (stores null)', async () => {
        await updateProfile(rawDb, 'ag1', { timezone: 'America/Chicago' });
        await updateProfile(rawDb, 'ag1', { timezone: '' });
        const row = await f.db.select({ tz: schema.users.timezone })
            .from(schema.users).where(eq(schema.users.id, 'ag1')).get();
        expect(row?.tz).toBeNull();
        expect((await getProfile(rawDb, 'ag1')).timezone).toBeNull();
    });

    it('rejects a non-resolvable timezone (fail-closed BadRequest, nothing persisted)', async () => {
        await expect(updateProfile(rawDb, 'ag1', { timezone: 'Not/AZone' }))
            .rejects.toMatchObject({ status: 400 });
        expect((await getProfile(rawDb, 'ag1')).timezone).toBeNull();
    });
});
