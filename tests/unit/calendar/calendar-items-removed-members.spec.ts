import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import * as schema from '../../../server/lib/db/schema';
import { listCalendarItems } from '../../../server/services/calendar-items.service';
import { createTestDb, setupSchema } from '../db';
import { ALL_INSPECTIONS } from '../../../server/lib/inspection/visibility';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

/**
 * A removed member is soft-deleted, and what they left in the date overrides
 * (synced or hand-entered) kept showing on the calendar as "Busy". The feed
 * ignores overrides of a soft-deleted user; a current member's still show.
 */
const TENANT = '00000000-0000-0000-0000-0000000000aa';
const OTHER_TENANT = '00000000-0000-0000-0000-0000000000bb';
const STAYS = 'user-stays';
const LEFT = 'user-left';

describe('calendar feed and removed members', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: ReturnType<typeof createTestDb>['sqlite'];

    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        sqlite = fixture.sqlite;
        await setupSchema(sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(db);
        const now = new Date();
        await db.insert(schema.tenants).values([
            { id: TENANT, slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: now },
            { id: OTHER_TENANT, slug: 'other', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: now },
        ]);
        const person = (id: string, tenantId: string, deletedAt?: Date) =>
            ({ id, tenantId, email: `${id}@x.test`, passwordHash: 'h', role: 'inspector' as const, name: id, createdAt: now, ...(deletedAt ? { deletedAt } : {}) });
        await db.insert(schema.users).values([person(STAYS, TENANT), person(LEFT, TENANT, now), person('same-id-elsewhere', OTHER_TENANT, now)]);
        const busy = (id: string, tenantId: string, inspectorId: string, source: 'google' | null) =>
            ({ id, tenantId, inspectorId, date: '2026-08-04', isAvailable: false, startTime: '10:00', endTime: '11:00', createdAt: now, ...(source ? { source, externalId: `e-${id}` } : {}) });
        await db.insert(schema.availabilityOverrides).values([
            busy('stays-synced', TENANT, STAYS, 'google'),
            busy('stays-manual', TENANT, STAYS, null),
            busy('left-synced', TENANT, LEFT, 'google'),
            busy('left-manual', TENANT, LEFT, null),
        ] as never);
    });
    afterEach(() => sqlite.close());

    const busyIds = async () =>
        (await listCalendarItems({} as D1Database, TENANT, { start: '2026-08-01', end: '2026-08-09' }, ALL_INSPECTIONS))
            .filter((i) => i.kind === 'external_busy').map((i) => i.id).sort();

    it('shows the busy blocks of current members and hides those of a removed member, synced or not', async () => {
        expect(await busyIds()).toEqual(['stays-manual', 'stays-synced']);
    });

    it('a removed member in another company has no effect on this company (tenant scoping)', async () => {
        await db.insert(schema.availabilityOverrides).values({
            id: 'other-company-row', tenantId: OTHER_TENANT, inspectorId: 'same-id-elsewhere', date: '2026-08-04', isAvailable: false, startTime: '10:00', endTime: '11:00', createdAt: new Date(),
        } as never);
        expect(await busyIds()).toEqual(['stays-manual', 'stays-synced']);
    });
});
