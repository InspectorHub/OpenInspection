/**
 * Synced date overrides (availability_overrides with a source) outlive their
 * calendar connection whenever it was removed some other way than the disconnect
 * route did: older releases deleted only the connection row, and a removed member
 * kept theirs. Nothing ever cleaned those up, and they keep hiding days from
 * customers. The sweep removes a synced row that has no live connection for the
 * same company, user AND provider - in bounded batches, idempotently.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, setupSchema } from '../db';
import { toD1Binding as toRawD1 } from '../helpers/d1-binding';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { removeOrphanedSyncedOverrides, hasOrphanedSyncedOverrides } from '../../../server/lib/calendar/orphan-sweep';
import { calendarOrphanSweepJob } from '../../../server/cron/jobs/integrations';

const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';
const now = new Date();

describe('removeOrphanedSyncedOverrides', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];

    const user = (id: string, tenantId: string) => db.insert(schema.users).values({ id, tenantId, email: `${id}@x.test`, passwordHash: 'h', role: 'inspector', name: id, createdAt: now });
    const connect = (id: string, tenantId: string, userId: string, provider: 'google' | 'apple') =>
        db.insert(schema.calendarConnections).values({
            id, tenantId, userId, provider, authType: provider === 'google' ? 'oauth' : 'caldav', credentialsEnc: 'x', credentialsDekEnc: 'y',
            capabilities: 'availability_read', calendarId: 'primary', connectedAt: now, updatedAt: now,
        } as never);
    const override = (id: string, tenantId: string, inspectorId: string, source: 'google' | 'apple' | null) =>
        db.insert(schema.availabilityOverrides).values({
            id, tenantId, inspectorId, date: '2027-01-05', isAvailable: false, startTime: '10:00', endTime: '11:00', createdAt: now,
            ...(source ? { source, externalId: `ev-${id}` } : {}),
        } as never);
    const left = async () => (await db.select({ id: schema.availabilityOverrides.id }).from(schema.availabilityOverrides).all()).map((r) => r.id).sort();

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        sqlite = fixture.sqlite;
        await setupSchema(sqlite);
        for (const t of [A, B]) {
            await db.insert(schema.tenants).values({ id: t, slug: t.slice(-1), status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: now } as never);
        }
        await user('u-a', A);
        await user('u-b', B);
    });
    afterEach(() => sqlite.close());

    it('removes synced rows with no live connection, and keeps everything else', async () => {
        await connect('c-live', A, 'u-a', 'google');
        await override('live-google', A, 'u-a', 'google');       // has its connection: stays
        await override('orphan-apple', A, 'u-a', 'apple');       // connected, but to another provider: orphan
        await override('manual', A, 'u-a', null);                // hand-entered: never touched
        await override('orphan-b', B, 'u-b', 'google');          // another company, no connection: orphan
        const raw = toRawD1(sqlite);
        expect(await hasOrphanedSyncedOverrides(raw)).toBe(true);
        expect(await removeOrphanedSyncedOverrides(raw, 100)).toBe(2);
        expect(await left()).toEqual(['live-google', 'manual']);
    });

    it('a connection in another company does not protect a row (the match includes the company)', async () => {
        await connect('c-b', B, 'u-a', 'google'); // same user id, wrong company
        await override('orphan', A, 'u-a', 'google');
        expect(await removeOrphanedSyncedOverrides(toRawD1(sqlite), 100)).toBe(1);
        expect(await left()).toEqual([]);
    });

    it('is bounded per run and idempotent: repeated runs finish the job, then find nothing', async () => {
        for (let i = 0; i < 5; i++) await override(`o${i}`, A, 'u-a', 'google');
        const raw = toRawD1(sqlite);
        expect(await removeOrphanedSyncedOverrides(raw, 2)).toBe(2);
        expect(await left()).toHaveLength(3);
        expect(await removeOrphanedSyncedOverrides(raw, 2)).toBe(2);
        expect(await removeOrphanedSyncedOverrides(raw, 2)).toBe(1);
        expect(await removeOrphanedSyncedOverrides(raw, 2)).toBe(0);
        expect(await hasOrphanedSyncedOverrides(raw)).toBe(false);
    });

    it('the daily job probes, removes a bounded batch and asks to continue until none are left', async () => {
        const env = { DB: toRawD1(sqlite) } as never;
        expect(await calendarOrphanSweepJob.probe(env)).toBe(0);
        for (let i = 0; i < calendarOrphanSweepJob.maxBatch + 1; i++) await override(`j${i}`, A, 'u-a', 'google');
        expect(await calendarOrphanSweepJob.probe(env)).toBeGreaterThan(0);
        const first = await calendarOrphanSweepJob.run(env, null);
        expect(first.processed).toBe(calendarOrphanSweepJob.maxBatch);
        expect(first.nextCursor).not.toBeNull();
        const second = await calendarOrphanSweepJob.run(env, first.nextCursor);
        expect(second).toEqual({ processed: 1, nextCursor: null });
        expect(await left()).toEqual([]);
    });

    it('reports nothing to do on a clean database', async () => {
        await connect('c', A, 'u-a', 'google');
        await override('live', A, 'u-a', 'google');
        const raw = toRawD1(sqlite);
        expect(await hasOrphanedSyncedOverrides(raw)).toBe(false);
        expect(await removeOrphanedSyncedOverrides(raw, 100)).toBe(0);
        expect(await left()).toEqual(['live']);
    });
});
