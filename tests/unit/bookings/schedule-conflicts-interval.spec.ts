/**
 * A-polish 9b.3 — interval-overlap branch of findScheduleConflicts.
 *
 * When BOTH the candidate and an existing row carry scheduled_start_ms/end_ms,
 * conflict is a half-open interval overlap (aStart < bEnd && bStart < aEnd):
 * touching intervals do NOT collide. When either side lacks the instant, the
 * function falls back to the legacy same-day-hour bucket.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, setupSchema } from '../db';
import { tenants, users, inspections, inspectionInspectors } from '../../../server/lib/db/schema';
import { findScheduleConflicts } from '../../../server/lib/schedule-conflicts';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';

const T = 't1';
const U1 = 'u1';
const U2 = 'u2';
const U3 = 'u3';

/** ms for a wall-clock UTC time on 2026-06-08. */
const at = (h: number, m = 0) => Date.UTC(2026, 5, 8, h, m, 0);
const iso = (h: number, m = 0) =>
    `2026-06-08T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`;

describe('findScheduleConflicts interval overlap', () => {
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
        await db.insert(users).values([
            { id: U1, tenantId: T, email: 'u1@x.com', passwordHash: 'h', role: 'inspector', name: 'A', createdAt: new Date() },
            { id: U2, tenantId: T, email: 'u2@x.com', passwordHash: 'h', role: 'inspector', name: 'B', createdAt: new Date() },
            { id: U3, tenantId: T, email: 'u3@x.com', passwordHash: 'h', role: 'inspector', name: 'C', createdAt: new Date() },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ] as any);
    });

    afterEach(() => sqlite.close());

    async function seed(id: string, userId: string, opts: {
        date: string; startMs?: number; endMs?: number;
    }) {
        await db.insert(inspections).values({
            id, tenantId: T, propertyAddress: `${id} St`, date: opts.date,
            status: 'scheduled', createdAt: new Date(), price: 0,
            scheduledStartMs: opts.startMs != null ? new Date(opts.startMs) : null,
            scheduledEndMs: opts.endMs != null ? new Date(opts.endMs) : null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
        await db.insert(inspectionInspectors).values({
            inspectionId: id, userId, tenantId: T, role: 'lead', createdAt: new Date(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
    }

    it('overlapping instants collide (09:00-11:00 vs candidate 10:30-11:30)', async () => {
        await seed('A', U1, { date: iso(9), startMs: at(9), endMs: at(11) });
        const result = await findScheduleConflicts(
            db as never, T, U1, iso(10, 30), undefined,
            { startMs: at(10, 30), endMs: at(11, 30) },
        );
        expect(result).toHaveLength(1);
        expect(result[0].inspectionId).toBe('A');
    });

    it('touching instants do NOT collide (09:00-10:00 vs candidate 10:00-11:00)', async () => {
        await seed('B', U2, { date: iso(9), startMs: at(9), endMs: at(10) });
        const result = await findScheduleConflicts(
            db as never, T, U2, iso(10), undefined,
            { startMs: at(10), endMs: at(11) },
        );
        expect(result).toHaveLength(0);
    });

    it('a legacy row with no instant falls back to the hour bucket', async () => {
        // C has no scheduled_start_ms; even though the candidate carries an
        // interval, the row lacks one, so the same-day-hour fallback decides —
        // 09:00 vs the 09:30 `date` argument shares the hour → conflict.
        await seed('C', U3, { date: iso(9) });
        const result = await findScheduleConflicts(
            db as never, T, U3, iso(9, 30), undefined,
            { startMs: at(10, 30), endMs: at(11, 30) },
        );
        expect(result).toHaveLength(1);
        expect(result[0].inspectionId).toBe('C');
    });
});
