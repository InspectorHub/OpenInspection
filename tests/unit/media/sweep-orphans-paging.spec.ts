/**
 * Paging contract for the orphan-media sweep.
 *
 * Before this change the sweep read EVERY inspection row on every five-minute
 * tick and, for each, read and parsed that inspection's whole report blob. That
 * was the single most expensive item in the scheduled path, and it grows with
 * the table — so a deployment that was inside the CPU budget on the day it was
 * written falls out of it later, silently, without a line of code changing.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { sweepOrphanedMedia } from '../../../server/lib/media/sweep-orphans';

const TENANT = 't1';
const NOW = Date.parse('2026-08-22T00:00:00.000Z');
const IDS = ['i1', 'i2', 'i3', 'i4', 'i5'];

/** An R2 double whose prefix listings are declared per inspection prefix. */
function makeR2(objectsByPrefix: Record<string, string[]> = {}) {
    return {
        list: vi.fn(async (opts: { prefix?: string }) => ({
            objects: (objectsByPrefix[opts.prefix ?? ''] ?? []).map((key) => ({ key })),
            truncated: false,
            cursor: undefined,
        })),
        delete: vi.fn(async () => undefined),
    };
}

describe('sweepOrphanedMedia paging', () => {
    let testDb: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const setup = createTestDb();
        testDb = setup.db;
        await setupSchema(setup.sqlite);
        (mockDrizzle as ReturnType<typeof vi.fn>).mockReturnValue(testDb);

        await testDb.insert(schema.tenants).values([{ id: TENANT, slug: 'acme', createdAt: new Date(NOW) }]);
        await testDb.insert(schema.inspections).values(IDS.map((id) => ({
            id, tenantId: TENANT, propertyAddress: `${id} Main St`, date: '2026-08-20', createdAt: new Date(NOW),
        })));
    });

    it('stops after `limit` inspections and returns a resumable cursor', async () => {
        const r2 = makeR2();
        const first = await sweepOrphanedMedia({} as D1Database, r2 as unknown as R2Bucket, NOW, {
            limit: 2, afterInspectionId: null,
        });
        expect(first.nextCursor, 'a partial sweep must say where to resume').toBe('i2');
        expect(r2.list, 'exactly `limit` inspections may be listed').toHaveBeenCalledTimes(2);
    });

    it('resumes after the cursor rather than restarting', async () => {
        const r2 = makeR2();
        const first = await sweepOrphanedMedia({} as D1Database, r2 as unknown as R2Bucket, NOW, {
            limit: 2, afterInspectionId: null,
        });
        const second = await sweepOrphanedMedia({} as D1Database, r2 as unknown as R2Bucket, NOW, {
            limit: 2, afterInspectionId: first.nextCursor,
        });
        expect(second.nextCursor).toBe('i4');
        expect(r2.list.mock.calls.map((c) => (c[0] as { prefix?: string }).prefix))
            .toEqual([`${TENANT}/i1/`, `${TENANT}/i2/`, `${TENANT}/i3/`, `${TENANT}/i4/`]);
    });

    it('returns a null cursor on the last page, so the sweep can end', async () => {
        const r2 = makeR2();
        const last = await sweepOrphanedMedia({} as D1Database, r2 as unknown as R2Bucket, NOW, {
            limit: 100, afterInspectionId: null,
        });
        expect(last.nextCursor).toBeNull();
        expect(r2.list).toHaveBeenCalledTimes(IDS.length);
    });

    it('does not read the report blob for an inspection whose R2 prefix is empty', async () => {
        // The read-and-parse is the expensive part, and it is pointless for an
        // inspection with nothing in R2 under its prefix: with no keys, the
        // classification's answer does not depend on the live-key set at all.
        // Measured as D1 reads, because that is the thing being removed.
        const selectSpy = vi.spyOn(testDb, 'select');
        const r2 = makeR2();
        await sweepOrphanedMedia({} as D1Database, r2 as unknown as R2Bucket, NOW, {
            limit: 5, afterInspectionId: null,
        });
        // 1 page read + 1 orphan-bookkeeping read per inspection. The report-blob
        // read and the media-pool read must not happen for any of the five.
        const expected = 1 + IDS.length;
        expect(
            selectSpy.mock.calls.length,
            `${selectSpy.mock.calls.length} D1 reads for ${IDS.length} empty inspections; ${expected} is the floor`,
        ).toBe(expected);
    });

    it('still reaps a genuine orphan — the sweep must not be optimised into a no-op', async () => {
        // The positive control. Every assertion above is satisfied by a sweep
        // that does nothing at all, which is the shape a paging bug takes.
        const key = `${TENANT}/i1/photo-a.jpg`;
        await testDb.insert(schema.inspectionResults).values({
            id: 'r1', tenantId: TENANT, inspectionId: 'i1', data: {}, lastSyncedAt: new Date(NOW),
        });
        await testDb.insert(schema.orphanedMedia).values({
            id: 'o1', tenantId: TENANT, inspectionId: 'i1', r2Key: key,
            firstSeenAt: new Date(NOW - 30 * 24 * 60 * 60 * 1000),
        });
        const r2 = makeR2({ [`${TENANT}/i1/`]: [key] });
        const result = await sweepOrphanedMedia({} as D1Database, r2 as unknown as R2Bucket, NOW, {
            limit: 5, afterInspectionId: null,
        });
        expect(result.reaped).toBe(1);
        expect(r2.delete).toHaveBeenCalledWith(key);
    });
});
