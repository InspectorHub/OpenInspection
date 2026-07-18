/**
 * A-polish 10b.4 — union busy across the multi-read calendar set.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, setupSchema } from '../db';
import { tenants, users, calendarConnectionReadCalendars } from '../../../server/lib/db/schema';
import { mergeBusyIntervals } from '../../../server/lib/calendar/sync-busy';
import { resolveReadCalendarIds } from '../../../server/lib/calendar/read-set';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';

const iso = (h: number, m = 0) => `2026-07-20T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`;

describe('mergeBusyIntervals', () => {
    it('merges overlapping intervals from different calendars into one', () => {
        // primary busy 09:00-10:00, work busy 09:30-11:00 → union 09:00-11:00.
        const merged = mergeBusyIntervals([
            { start: iso(9), end: iso(10) },
            { start: iso(9, 30), end: iso(11) },
        ]);
        expect(merged).toHaveLength(1);
        expect(merged[0].start).toBe(iso(9));
        expect(merged[0].end).toBe(iso(11));
    });

    it('keeps disjoint intervals separate', () => {
        const merged = mergeBusyIntervals([
            { start: iso(9), end: iso(10) },
            { start: iso(10, 30), end: iso(11) },
        ]);
        expect(merged.map((b) => [b.start, b.end])).toEqual([
            [iso(9), iso(10)],
            [iso(10, 30), iso(11)],
        ]);
    });

    it('drops transparent (free) events from the union', () => {
        const merged = mergeBusyIntervals([
            { start: iso(9), end: iso(10), transparency: 'opaque' },
            { start: iso(9, 30), end: iso(11), transparency: 'transparent' },
        ]);
        expect(merged).toHaveLength(1);
        expect(merged[0].end).toBe(iso(10)); // transparent 09:30-11:00 excluded
    });
});

const T = 't1';
const CONN = 'conn-1';

describe('resolveReadCalendarIds', () => {
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
            id: 'insp-1', tenantId: T, email: 'i@x.com', passwordHash: 'h',
            role: 'inspector', name: 'I', createdAt: new Date(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
    });
    afterEach(() => sqlite.close());

    it('falls back to the write/primary calendar when no read set is configured', async () => {
        const ids = await resolveReadCalendarIds(db as never, {
            tenantId: T, connectionId: CONN, fallbackCalendarId: 'primary',
        });
        expect(ids).toEqual(['primary']);
    });

    it('returns the configured read set when present', async () => {
        const now = new Date();
        await db.insert(calendarConnectionReadCalendars).values([
            { id: 'r1', tenantId: T, connectionId: CONN, externalCalendarId: 'primary', summary: 'Me', accessRole: 'owner', createdAt: now, updatedAt: now },
            { id: 'r2', tenantId: T, connectionId: CONN, externalCalendarId: 'work', summary: 'Work', accessRole: 'writer', createdAt: now, updatedAt: now },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ] as any);
        const ids = await resolveReadCalendarIds(db as never, {
            tenantId: T, connectionId: CONN, fallbackCalendarId: 'primary',
        });
        expect(ids.sort()).toEqual(['primary', 'work']);
    });
});
