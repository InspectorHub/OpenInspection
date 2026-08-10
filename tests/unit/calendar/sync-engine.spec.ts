import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

const listBusy = vi.fn();
vi.mock('../../../server/lib/calendar/registry', () => ({
    getCalendarProvider: () => ({ listBusy }),
}));

import { importBusyForConnection, SYNC_WINDOW_DAYS } from '../../../server/lib/calendar/sync-engine';
import { upsertLink } from '../../../server/lib/calendar/external-links';
import type { CalendarConnectionRow } from '../../../server/lib/calendar/connection';
import type { CalendarAuth } from '../../../server/lib/calendar/provider';

// One opaque provider-minted handle replaces the three OAuth values the engine
// used to take by hand. The engine never looks inside it.
const auth = {
    provider: 'google',
    material: { clientId: 'cid', clientSecret: 'sec', refreshToken: 'rt' },
} as CalendarAuth;

const TENANT = '00000000-0000-0000-0000-000000000001';
const USER = '00000000-0000-0000-0000-000000000010';
const NOW = Date.UTC(2026, 5, 1, 12, 0);
const CONNECTED_AT = new Date(Date.UTC(2026, 4, 1, 0, 0));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

const connection = {
    id: 'conn-1',
    tenantId: TENANT,
    userId: USER,
    provider: 'google',
    authType: 'oauth',
    credentialsEnc: 'x',
    credentialsDekEnc: 'x',
    capabilities: 'events_read_write',
    calendarId: 'primary',
    connectedAt: CONNECTED_AT,
    updatedAt: CONNECTED_AT,
    lastSyncAt: null,
} as unknown as CalendarConnectionRow;

function ev(over: Record<string, unknown> = {}) {
    return {
        start: '2026-06-10T14:00:00Z',
        end: '2026-06-10T16:00:00Z',
        externalId: 'ev-1',
        transparency: 'opaque',
        createdMs: Date.UTC(2026, 5, 2),
        ...over,
    };
}

describe('importBusyForConnection', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        sqlite = fixture.sqlite;
        await setupSchema(sqlite);
        await db.insert(schema.tenants).values({
            id: TENANT, name: 'A', slug: 'a', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await db.insert(schema.tenantConfigs).values({
            tenantId: TENANT, defaultTimezone: 'America/New_York', updatedAt: new Date(),
        });
        // availability_overrides carries legacy FKs to users/tenants.
        await db.insert(schema.users).values({
            id: USER, tenantId: TENANT, email: 'i@t.com', role: 'inspector',
            passwordHash: 'x', createdAt: new Date(),
        });
        listBusy.mockReset();
    });

    afterEach(() => { sqlite.close(); vi.clearAllMocks(); });

    const overrides = () => db.select().from(schema.availabilityOverrides).all();

    /**
     * The reason the engine consumes raw listBusy output. mergeBusyIntervals
     * unions ranges into ANONYMOUS blocks, and the persistence layer then keys
     * its upsert on a synthesised `fb:<start>:<end>` string — which changes the
     * moment anyone nudges an event, so every sync churns rows instead of
     * updating them.
     */
    it('persists the provider event id, not a synthesised range key', async () => {
        listBusy.mockResolvedValue([ev({ externalId: 'google-abc' })]);
        const out = await importBusyForConnection(db as AnyDb, connection, auth, NOW);

        expect(out.upserted).toBe(1);
        const rows = await overrides();
        expect(rows[0]!.externalId).toBe('google-abc');
        expect(rows[0]!.source).toBe('google');
    });

    it('keeps two overlapping events as two identified rows rather than one merged blob', async () => {
        listBusy.mockResolvedValue([
            ev({ externalId: 'a', start: '2026-06-10T14:00:00Z', end: '2026-06-10T16:00:00Z' }),
            ev({ externalId: 'b', start: '2026-06-10T15:00:00Z', end: '2026-06-10T17:00:00Z' }),
        ]);
        await importBusyForConnection(db as AnyDb, connection, auth, NOW);

        const ids = (await overrides()).map((r) => r.externalId).sort();
        expect(ids).toEqual(['a', 'b']);
    });

    it('does not import an event OI pushed itself', async () => {
        await upsertLink(db as AnyDb, {
            tenantId: TENANT, provider: 'google', entityType: 'inspection',
            entityId: 'insp-1', userId: USER, externalId: 'ours',
        });
        listBusy.mockResolvedValue([ev({ externalId: 'ours' }), ev({ externalId: 'theirs' })]);

        const out = await importBusyForConnection(db as AnyDb, connection, auth, NOW);
        expect(out.skipped.oi_originated).toBe(1);
        expect((await overrides()).map((r) => r.externalId)).toEqual(['theirs']);
    });

    it('does not import recurring instances', async () => {
        listBusy.mockResolvedValue([ev({ externalId: 'r1', recurringEventId: 'series' })]);
        const out = await importBusyForConnection(db as AnyDb, connection, auth, NOW);
        expect(out.skipped.recurring_instance).toBe(1);
        expect(await overrides()).toHaveLength(0);
    });

    it('does not backfill events that predate the connection', async () => {
        listBusy.mockResolvedValue([ev({ externalId: 'old', createdMs: Date.UTC(2026, 3, 1) })]);
        const out = await importBusyForConnection(db as AnyDb, connection, auth, NOW);
        expect(out.skipped.before_connect).toBe(1);
        expect(await overrides()).toHaveLength(0);
    });

    /**
     * The shipped window is 30 days. The plan proposed 90, which would triple
     * every sync's provider cost and override churn; keeping 30 is a decision,
     * so it is pinned rather than left to drift.
     */
    it('asks the provider for the shipped 30-day window', async () => {
        listBusy.mockResolvedValue([]);
        await importBusyForConnection(db as AnyDb, connection, auth, NOW);

        expect(SYNC_WINDOW_DAYS).toBe(30);
        const { range } = listBusy.mock.calls[0]![0] as { range: { from: Date; to: Date } };
        expect(range.from.getTime()).toBe(NOW);
        expect(range.to.getTime() - range.from.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
    });

    it('stores busy time as tenant-local wall clock, not UTC', async () => {
        // 14:00Z on 2026-06-10 is 10:00 in America/New_York (EDT).
        listBusy.mockResolvedValue([ev()]);
        await importBusyForConnection(db as AnyDb, connection, auth, NOW);

        const row = (await overrides())[0]!;
        expect(row.date).toBe('2026-06-10');
        expect(row.startTime).toBe('10:00');
        expect(row.endTime).toBe('12:00');
    });

    it('reports the provider total separately from what survived the rules', async () => {
        listBusy.mockResolvedValue([
            ev({ externalId: 'keep' }),
            ev({ externalId: 'r', recurringEventId: 's' }),
        ]);
        const out = await importBusyForConnection(db as AnyDb, connection, auth, NOW);
        expect(out).toMatchObject({ totalEvents: 2, upserted: 1 });
    });
});
