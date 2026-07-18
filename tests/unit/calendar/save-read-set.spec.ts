/**
 * A-polish 10b.3 — read-set invariants + persistence.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, setupSchema } from '../db';
import { tenants, users, calendarConnections, calendarConnectionReadCalendars } from '../../../server/lib/db/schema';
import { resolveReadSet, saveReadSet } from '../../../server/lib/calendar/read-set';
import { and, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';

const AVAILABLE = [
    { id: 'primary', summary: 'Me', accessRole: 'owner', primary: true },
    { id: 'work', summary: 'Work', accessRole: 'writer', primary: false },
    { id: 'shared', summary: 'Shared', accessRole: 'reader', primary: false },
];

describe('resolveReadSet invariants', () => {
    it('rejects a write target that is not in the submitted read set', () => {
        expect(() => resolveReadSet(AVAILABLE, { readCalendarIds: ['primary'], writeCalendarId: 'work' }))
            .toThrow(/read set/i);
    });

    it('rejects a reader calendar as the write target', () => {
        expect(() => resolveReadSet(AVAILABLE, { readCalendarIds: ['shared'], writeCalendarId: 'shared' }))
            .toThrow(/edit|owner|writer/i);
    });

    it('rejects an unknown write calendar', () => {
        expect(() => resolveReadSet(AVAILABLE, { readCalendarIds: ['nope'], writeCalendarId: 'nope' }))
            .toThrow(/not found/i);
    });

    it('accepts a valid set and always includes Primary even if omitted', () => {
        const r = resolveReadSet(AVAILABLE, { readCalendarIds: ['work'], writeCalendarId: 'work' });
        expect(r.writeCalendarId).toBe('work');
        expect([...r.readCalendarIds].sort()).toEqual(['primary', 'work']);
        expect(r.entries.map((e) => e.id).sort()).toEqual(['primary', 'work']);
    });
});

const T = 't1';
const CONN = 'conn-1';

describe('saveReadSet persistence', () => {
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
        await db.insert(calendarConnections).values({
            id: CONN, tenantId: T, userId: 'insp-1', provider: 'google', authType: 'oauth',
            credentialsEnc: 'x', credentialsDekEnc: 'x', capabilities: 'availability_read',
            calendarId: 'primary', connectedAt: new Date(), updatedAt: new Date(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
    });
    afterEach(() => sqlite.close());

    const readRows = () => db.select().from(calendarConnectionReadCalendars)
        .where(and(eq(calendarConnectionReadCalendars.tenantId, T), eq(calendarConnectionReadCalendars.connectionId, CONN)))
        .all();

    it('replaces read rows and points calendar_id at the write target', async () => {
        await saveReadSet(db as never, {
            tenantId: T, connectionId: CONN,
            resolved: resolveReadSet(AVAILABLE, { readCalendarIds: ['work'], writeCalendarId: 'work' }),
        });
        expect((await readRows()).map((r) => r.externalCalendarId).sort()).toEqual(['primary', 'work']);
        const conn = await db.select().from(calendarConnections).where(eq(calendarConnections.id, CONN)).get();
        expect(conn!.calendarId).toBe('work');

        // Re-saving replaces the prior set (no accumulation).
        await saveReadSet(db as never, {
            tenantId: T, connectionId: CONN,
            resolved: resolveReadSet(AVAILABLE, { readCalendarIds: ['primary'], writeCalendarId: 'primary' }),
        });
        expect((await readRows()).map((r) => r.externalCalendarId)).toEqual(['primary']);
        const conn2 = await db.select().from(calendarConnections).where(eq(calendarConnections.id, CONN)).get();
        expect(conn2!.calendarId).toBe('primary');
    });
});
