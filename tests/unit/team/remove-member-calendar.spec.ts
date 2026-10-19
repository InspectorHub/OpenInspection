/**
 * TeamService.removeMember and the removed member's calendar.
 *
 * Removal soft-deletes the user. Their calendar connection used to stay (and kept
 * syncing every few minutes), and so did the busy blocks it had imported, the
 * read-calendar choices and the links to events on their calendar. Removal now
 * deletes all four in the same operation as the soft-delete, scoped to this
 * company and this member. Hand-entered overrides are not deleted (the calendar
 * feed ignores a removed member's rows).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { TeamService } from '../../../server/services/team.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '11111111-1111-1111-1111-1111111111a1';
const OTHER_TENANT = '22222222-2222-2222-2222-2222222222b2';
const OWNER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
const LEAVER = 'cccccccc-cccc-cccc-cccc-ccccccccccc1';
const COLLEAGUE = 'cccccccc-cccc-cccc-cccc-ccccccccccc2';
const STRANGER = 'dddddddd-dddd-dddd-dddd-ddddddddddd1';
const now = new Date();

type Db = BetterSQLite3Database<typeof schema>;

const person = (id: string, role: 'owner' | 'inspector', tenantId = TENANT) =>
    ({ id, tenantId, email: `${id}@t.test`, name: id, role, passwordHash: 'x', createdAt: now });

async function seed(db: Db) {
    await db.insert(schema.tenants).values([
        { id: TENANT, slug: 'a', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: now },
        { id: OTHER_TENANT, slug: 'b', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: now },
    ]);
    await db.insert(schema.users).values([person(OWNER, 'owner'), person(LEAVER, 'inspector'), person(COLLEAGUE, 'inspector'), person(STRANGER, 'inspector', OTHER_TENANT)]);
    const conn = (id: string, tenantId: string, userId: string) => ({
        id, tenantId, userId, provider: 'google' as const, authType: 'oauth' as const, credentialsEnc: 'x', credentialsDekEnc: 'y',
        capabilities: 'availability_read' as const, calendarId: 'primary', connectedAt: now, updatedAt: now,
    });
    await db.insert(schema.calendarConnections).values([conn('c-leaver', TENANT, LEAVER), conn('c-colleague', TENANT, COLLEAGUE), conn('c-stranger', OTHER_TENANT, STRANGER)]);
    const rc = (id: string, tenantId: string, connectionId: string) => ({ id, tenantId, connectionId, externalCalendarId: `cal-${id}`, createdAt: now, updatedAt: now });
    await db.insert(schema.calendarConnectionReadCalendars).values([rc('rc-leaver', TENANT, 'c-leaver'), rc('rc-colleague', TENANT, 'c-colleague'), rc('rc-stranger', OTHER_TENANT, 'c-stranger')]);
    const link = (id: string, tenantId: string, userId: string) => ({ id, tenantId, userId, provider: 'google' as const, entityType: 'calendar_block' as const, entityId: `e-${id}`, externalId: `x-${id}`, createdAt: now, updatedAt: now });
    await db.insert(schema.calendarExternalLinks).values([link('l-leaver', TENANT, LEAVER), link('l-colleague', TENANT, COLLEAGUE), link('l-stranger', OTHER_TENANT, STRANGER)]);
    const ov = (id: string, tenantId: string, inspectorId: string, synced: boolean) => ({
        id, tenantId, inspectorId, date: '2027-01-05', isAvailable: false, startTime: '10:00', endTime: '11:00', createdAt: now,
        ...(synced ? { source: 'google' as const, externalId: `ev-${id}` } : {}),
    });
    await db.insert(schema.availabilityOverrides).values([
        ov('o-leaver-synced', TENANT, LEAVER, true), ov('o-leaver-manual', TENANT, LEAVER, false),
        ov('o-colleague-synced', TENANT, COLLEAGUE, true), ov('o-stranger-synced', OTHER_TENANT, STRANGER, true),
    ] as never);
}

const ids = async (db: Db, table: 'calendarConnections' | 'calendarConnectionReadCalendars' | 'calendarExternalLinks' | 'availabilityOverrides') =>
    (await db.select({ id: schema[table].id }).from(schema[table]).all()).map((r) => r.id).sort();

describe('removing a member cleans up their calendar', () => {
    let db: Db;
    let svc: TeamService;
    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        await setupSchema(fix.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(db);
        await seed(db);
        svc = new TeamService({} as D1Database);
    });

    it('deletes the member\'s connection, read calendars, links and synced overrides together with the soft-delete, and nobody else\'s', async () => {
        await svc.removeMember(TENANT, LEAVER, OWNER, 'owner');
        expect((await db.select({ d: schema.users.deletedAt }).from(schema.users).where(eq(schema.users.id, LEAVER)).get())?.d).not.toBeNull();
        expect(await ids(db, 'calendarConnections')).toEqual(['c-colleague', 'c-stranger']);
        expect(await ids(db, 'calendarConnectionReadCalendars')).toEqual(['rc-colleague', 'rc-stranger']);
        expect(await ids(db, 'calendarExternalLinks')).toEqual(['l-colleague', 'l-stranger']);
        expect(await ids(db, 'availabilityOverrides')).toEqual(['o-colleague-synced', 'o-leaver-manual', 'o-stranger-synced']);
    });

    it('a refused removal (the last owner) changes nothing', async () => {
        await expect(svc.removeMember(TENANT, OWNER, LEAVER, 'inspector')).rejects.toBeTruthy();
        expect(await ids(db, 'calendarConnections')).toHaveLength(3);
        expect(await ids(db, 'availabilityOverrides')).toHaveLength(4);
    });
});
