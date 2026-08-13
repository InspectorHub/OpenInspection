/**
 * ⚠️ The distinction the slot map draws was never "Google". It was
 * SYNCED versus MANUAL.
 *
 * A synced busy row is TIMED: it subtracts only the slots it overlaps, the way
 * a timed calendar block does. A manual override is a whole-day statement about
 * availability. The old code decided which by comparing `source` to the literal
 * `'google'`, so an Apple-sourced row fell into the manual branch and blanked
 * out the inspector's entire day from one personal appointment — silently, and
 * only on the public booking page.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { buildTenantSlotMap, type SlotOverrideRow } from '../../../server/lib/booking/tenant-slot-map';
import { syncProviderBusyOverrides } from '../../../server/lib/calendar/sync-busy';

const TENANT = '00000000-0000-0000-0000-000000000001';
const INSPECTOR = '00000000-0000-0000-0000-000000000010';
const DATE = '2026-06-10';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

const WINDOW = { inspectorId: INSPECTOR, startTime: '09:00', endTime: '17:00' };
// `as const` is required, not stylistic: intervalMin is BookingSlotIntervalMin
// (15 | 30 | 60), and a bare 60 widens to number. Same shape as the sibling
// spec in tests/unit/bookings/transparent-not-busy.spec.ts.
const GRID = { intervalMin: 60 as const };

function slotsFor(overrides: SlotOverrideRow[]): string[] {
    const map = buildTenantSlotMap([INSPECTOR], [WINDOW], overrides, [], [], GRID);
    return [...map.entries()]
        .filter(([, free]) => free.has(INSPECTOR))
        .map(([time]) => time)
        .sort();
}

const timed = (source: 'google' | 'apple' | null, over: Partial<SlotOverrideRow> = {}): SlotOverrideRow => ({
    inspectorId: INSPECTOR,
    isAvailable: false,
    startTime: '10:00',
    endTime: '12:00',
    source,
    ...over,
});

describe('timed-vs-manual busy is decided by synced-or-not', () => {
    it('subtracts only the overlapping slots for an apple-sourced timed override', () => {
        const free = slotsFor([timed('apple')]);
        expect(free).not.toContain('10:00');
        expect(free).not.toContain('11:00');
        // The rest of the day survives — this is the whole point.
        expect(free).toContain('09:00');
        expect(free).toContain('13:00');
        expect(free.length).toBeGreaterThan(2);
    });

    it('behaves identically for a google-sourced one', () => {
        expect(slotsFor([timed('apple')])).toEqual(slotsFor([timed('google')]));
    });

    it('keeps whole-day blocking for a manual override with no source', () => {
        expect(slotsFor([timed(null)])).toEqual([]);
    });

    it('blocks nothing for a transparent apple row', () => {
        expect(slotsFor([timed('apple', { transparency: 'transparent' })]))
            .toEqual(slotsFor([]));
    });
});

describe('syncProviderBusyOverrides scopes its delete to its own source', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];

    const params = {
        tenantId: TENANT,
        inspectorId: INSPECTOR,
        tenantTz: 'UTC',
        rangeFromMs: Date.parse(`${DATE}T00:00:00Z`),
        rangeToMs: Date.parse('2026-06-20T00:00:00Z'),
    };

    async function seed(source: 'google' | 'apple', externalId: string) {
        await db.insert(schema.availabilityOverrides).values({
            id: crypto.randomUUID(), tenantId: TENANT, inspectorId: INSPECTOR,
            date: DATE, isAvailable: false, startTime: '10:00', endTime: '11:00',
            source, externalId, transparency: 'opaque', createdAt: new Date(),
        });
    }

    const rows = () => db.select().from(schema.availabilityOverrides).all();

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        sqlite = fixture.sqlite;
        await setupSchema(sqlite);
        await db.insert(schema.tenants).values({
            id: TENANT, slug: 'a', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await db.insert(schema.users).values({
            id: INSPECTOR, tenantId: TENANT, email: 'i@t.com', role: 'inspector',
            passwordHash: 'x', createdAt: new Date(),
        });
    });

    afterEach(() => sqlite.close());

    it('does not clear google rows when apple syncs', async () => {
        await seed('google', 'g-1');
        await syncProviderBusyOverrides(db as AnyDb, { ...params, source: 'apple' }, []);
        expect((await rows()).map((r) => r.externalId)).toEqual(['g-1']);
    });

    it('does not clear apple rows when google syncs', async () => {
        await seed('apple', 'a-1');
        await syncProviderBusyOverrides(db as AnyDb, { ...params, source: 'google' }, []);
        expect((await rows()).map((r) => r.externalId)).toEqual(['a-1']);
    });

    it('writes the source it was given, not a literal', async () => {
        await syncProviderBusyOverrides(db as AnyDb, { ...params, source: 'apple' }, [{
            start: `${DATE}T14:00:00Z`, end: `${DATE}T15:00:00Z`, externalId: '/cal/1.ics',
        }]);
        const written = await rows();
        expect(written).toHaveLength(1);
        expect(written[0]!.source).toBe('apple');
        expect(written[0]!.externalId).toBe('/cal/1.ics');
    });
});
