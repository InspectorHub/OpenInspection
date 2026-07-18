/**
 * A-polish 10.3 — Google busy sync writes timed availability_overrides.
 *
 * The extracted syncGoogleBusyOverrides helper: converts provider busy blocks to
 * tenant-tz civil date + wall-clock start/end, deletes stale google rows in the
 * synced range first, then upserts keyed on (inspector, source, external_id).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, setupSchema } from '../db';
import { tenants, users, availabilityOverrides } from '../../../server/lib/db/schema';
import { syncGoogleBusyOverrides } from '../../../server/lib/calendar/sync-busy';
import { and, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';

const T = 't1';
const INSP = 'insp-1';
const TZ = 'UTC';
// Sync window: 2026-07-20 .. 2026-07-27 (epoch ms).
const FROM = Date.UTC(2026, 6, 20, 0, 0, 0);
const TO = Date.UTC(2026, 6, 27, 0, 0, 0);

const OPAQUE = { start: '2026-07-20T09:00:00Z', end: '2026-07-20T10:30:00Z', externalId: 'evt-opaque', transparency: 'opaque' as const };
const TRANSPARENT = { start: '2026-07-21T14:00:00Z', end: '2026-07-21T15:00:00Z', externalId: 'evt-free', transparency: 'transparent' as const };

describe('syncGoogleBusyOverrides', () => {
    let db: BetterSQLite3Database<typeof schema>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sqlite: any;

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db as BetterSQLite3Database<typeof schema>;
        sqlite = fix.sqlite;
        await setupSchema(sqlite);
        await db.insert(tenants).values({
            id: T, name: 'Co', slug: 'co', tier: 'free', status: 'active',
            maxUsers: 5, deploymentMode: 'shared', createdAt: new Date(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
        await db.insert(users).values({
            id: INSP, tenantId: T, email: 'i@x.com', passwordHash: 'h',
            role: 'inspector', name: 'I', createdAt: new Date(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
    });
    afterEach(() => sqlite.close());

    const params = { tenantId: T, inspectorId: INSP, tenantTz: TZ, rangeFromMs: FROM, rangeToMs: TO };
    const googleRows = () => db.select().from(availabilityOverrides)
        .where(and(eq(availabilityOverrides.tenantId, T), eq(availabilityOverrides.source, 'google')))
        .orderBy(availabilityOverrides.date).all();

    it('stores each block as a timed google override with its transparency', async () => {
        const res = await syncGoogleBusyOverrides(db as never, params, [OPAQUE, TRANSPARENT]);
        expect(res.upserted).toBe(2);
        const rows = await googleRows();
        expect(rows).toHaveLength(2);
        const opaque = rows.find(r => r.externalId === 'evt-opaque')!;
        expect(opaque.date).toBe('2026-07-20');
        expect(opaque.startTime).toBe('09:00');
        expect(opaque.endTime).toBe('10:30');
        expect(opaque.isAvailable).toBe(false);
        expect(opaque.transparency).toBe('opaque');
        const free = rows.find(r => r.externalId === 'evt-free')!;
        expect(free.transparency).toBe('transparent');
        expect(free.startTime).toBe('14:00');
    });

    it('re-syncing the same events updates in place (no duplicates)', async () => {
        await syncGoogleBusyOverrides(db as never, params, [OPAQUE, TRANSPARENT]);
        // Same external ids, opaque moved to a new time.
        await syncGoogleBusyOverrides(db as never, params, [
            { ...OPAQUE, start: '2026-07-20T11:00:00Z', end: '2026-07-20T12:00:00Z' },
            TRANSPARENT,
        ]);
        const rows = await googleRows();
        expect(rows).toHaveLength(2);
        expect(rows.find(r => r.externalId === 'evt-opaque')!.startTime).toBe('11:00');
    });

    it('deletes stale google rows in range that are absent from the new result', async () => {
        // Seed a google row that the next sync will not return.
        await db.insert(availabilityOverrides).values({
            id: 'stale-1', tenantId: T, inspectorId: INSP, date: '2026-07-22',
            isAvailable: false, startTime: '08:00', endTime: '09:00',
            source: 'google', externalId: 'evt-gone', transparency: 'opaque',
            createdAt: new Date(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
        await syncGoogleBusyOverrides(db as never, params, [OPAQUE]);
        const rows = await googleRows();
        expect(rows.map(r => r.externalId)).toEqual(['evt-opaque']);
    });

    it('leaves manual overrides untouched', async () => {
        await db.insert(availabilityOverrides).values({
            id: 'manual-1', tenantId: T, inspectorId: INSP, date: '2026-07-23',
            isAvailable: false, startTime: null, endTime: null,
            source: null, externalId: null, transparency: null,
            createdAt: new Date(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
        await syncGoogleBusyOverrides(db as never, params, [OPAQUE]);
        const manual = await db.select().from(availabilityOverrides)
            .where(and(eq(availabilityOverrides.tenantId, T), eq(availabilityOverrides.id, 'manual-1'))).get();
        expect(manual).toBeTruthy();
    });
});
