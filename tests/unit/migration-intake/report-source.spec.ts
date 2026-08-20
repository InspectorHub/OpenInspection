/**
 * What the report has to carry so the later steps have something to ask about.
 *
 * The batch stores ROWS, and rows are the mapping's OUTPUT — they cannot be
 * read backwards into the mapping that produced them. So the report re-reads
 * the stored file and re-derives both the columns and the starting mapping
 * every time it is built. Re-derived rather than remembered: a reopened run
 * then shows the file's real columns instead of a snapshot that may no longer
 * describe it.
 *
 * The consequence is asserted in BOTH directions from ONE fixture, because
 * "null after the file was cleared" on its own is indistinguishable from a
 * field that is always null. The same batch reports real columns while its file
 * is stored and nothing once it is gone — and nothing is the right answer, not
 * an edge case: with no file there is no mapping left to change, so the step
 * disappears rather than rendering a control that can alter nothing.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Database as SqliteDatabase } from 'better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { asD1DrizzleReturn } from '../helpers/test-db';
import { withBatch } from '../helpers/d1-binding';
import type { EntityCounts, MigrationBundleV1 } from '../../../server/lib/migration-intake/bundle';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { MigrationStageService } from '../../../server/services/migration-intake/stage.service';
import { MigrationReportService } from '../../../server/services/migration-intake/report.service';
import { limitsFor } from '../../../server/lib/migration-intake/limits';
import { SAAS_PROFILE } from '../../../server/lib/deployment-profile';

const TENANT = '11111111-1111-1111-1111-1111111111a1';
const USER = '22222222-2222-2222-2222-2222222222b2';
const LIMITS = limitsFor(SAAS_PROFILE);
const KEY = `${TENANT}/migrations/mapme/source.csv`;
const CSV = 'Full Name,Email\nAlice Ng,alice@example.test\n';

const EMPTY: EntityCounts = { readFromSource: 0, emitted: 0, dropped: [] };

function contactsBundle(list: unknown[]): MigrationBundleV1 {
    return {
        formatVersion: 1,
        manifest: {
            source: { vendor: 'csv_generic' },
            adapter: { name: 'csv-generic', version: '1' },
            counts: {
                template: EMPTY,
                contact: { readFromSource: list.length, emitted: list.length, dropped: [] },
                member: EMPTY,
            },
            warnings: [],
        },
        templates: [], contacts: list as MigrationBundleV1['contacts'], members: [],
    };
}

/**
 * A bucket that holds exactly one object, or none.
 *
 * The read is recorded so the assertions can show the report asked for THIS
 * run's key. A stub that answered every key the same way would let a report
 * that read the wrong object pass.
 */
function fakeBucket(text: string | null) {
    const reads: string[] = [];
    return {
        reads,
        put: vi.fn(),
        delete: vi.fn(),
        get: vi.fn(async (key: string) => {
            reads.push(key);
            if (text === null) return null;
            return { text: async () => text } as unknown as R2ObjectBody;
        }),
    };
}

type FakeBucket = ReturnType<typeof fakeBucket>;

function reportOver(bucket: FakeBucket) {
    return new MigrationReportService({} as D1Database, bucket as unknown as R2Bucket);
}

describe('the report carries what the later steps have to ask about', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: SqliteDatabase;
    let stage: MigrationStageService;

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        sqlite = fix.sqlite;
        await setupSchema(sqlite);
        // Staging batches its writes, and better-sqlite3 is the one Drizzle
        // driver with no `batch()` — see helpers/d1-binding.ts.
        vi.mocked(mockDrizzle).mockReturnValue(asD1DrizzleReturn(withBatch(db, sqlite)));
        await db.insert(schema.tenants).values({
            id: TENANT, slug: 'a', status: 'active', deploymentMode: 'shared',
            tier: 'free', maxUsers: 12, createdAt: new Date(),
        });
        stage = new MigrationStageService({} as D1Database);
    });

    afterEach(() => {
        sqlite.close();
        vi.clearAllMocks();
    });

    async function staged(opts: { sourceKey?: string | null; expiresAt?: Date } = {}) {
        const result = await stage.stage({
            tenantId: TENANT, createdBy: USER, intent: 'contacts.import', limits: LIMITS,
            sourceKey: opts.sourceKey === undefined ? KEY : opts.sourceKey,
            ...(opts.expiresAt ? { expiresAt: opts.expiresAt } : {}),
            bundle: contactsBundle([{ name: 'Alice Ng', email: 'alice@example.test', type: 'client' }]),
        });
        return result.batchId;
    }

    it('reports the file columns and a starting mapping', async () => {
        const batchId = await staged();
        const bucket = fakeBucket(CSV);
        const r = await reportOver(bucket).build({ tenantId: TENANT, batchId, seatQuotaEnforced: false });

        expect(bucket.reads).toEqual([KEY]);
        expect(r.inspection?.columns).toEqual(['Full Name', 'Email']);
        expect(r.inspection?.sampleRows).toEqual([{ 'Full Name': 'Alice Ng', Email: 'alice@example.test' }]);
        // The CONTENT, field by field. `mapping` merely being non-null would
        // also be satisfied by an empty object, which is the one answer the
        // mapping step cannot start from.
        expect(r.mapping).toEqual({
            kind: 'contacts',
            mapping: { name: 'Full Name', email: 'Email', type: { fixed: 'client' } },
        });
    });

    it('reports neither once the file has been cleared, so the step disappears', async () => {
        const batchId = await staged();

        // Same run, same key, read twice: with the object present and after a
        // sweep took it. The first arm is the positive control for the second —
        // without it, "null" would prove nothing about this field at all.
        const present = await reportOver(fakeBucket(CSV))
            .build({ tenantId: TENANT, batchId, seatQuotaEnforced: false });
        expect(present.inspection).not.toBeNull();
        expect(present.mapping).not.toBeNull();

        const swept = fakeBucket(null);
        const r = await reportOver(swept).build({ tenantId: TENANT, batchId, seatQuotaEnforced: false });
        expect(swept.reads).toEqual([KEY]);
        expect(r.inspection).toBeNull();
        expect(r.mapping).toBeNull();
        // Everything else still works: the run can still be applied or undone.
        expect(r.counts.total).toBe(1);
        expect(r.counts).toEqual({ total: 1, ok: 1, conflicts: 0, problems: 0 });
    });

    it('asks the bucket nothing when the run never had a stored file', async () => {
        const batchId = await staged({ sourceKey: null });
        const bucket = fakeBucket(CSV);
        const r = await reportOver(bucket).build({ tenantId: TENANT, batchId, seatQuotaEnforced: false });

        expect(bucket.reads).toEqual([]);
        expect(r.inspection).toBeNull();
        expect(r.mapping).toBeNull();
    });

    it('echoes each problem entry, because a repair replaces the whole entry', async () => {
        const batchId = await staged();
        await db.update(schema.migrationRows)
            .set({ payload: JSON.stringify({ name: '', email: 'alice@example.test', type: 'client' }) })
            .where(eq(schema.migrationRows.batchId, batchId));
        const r = await reportOver(fakeBucket(CSV))
            .build({ tenantId: TENANT, batchId, seatQuotaEnforced: false });

        expect(r.problemRows).toHaveLength(1);
        expect(r.problemRows[0].payloadEcho)
            .toEqual({ name: '', email: 'alice@example.test', type: 'client' });
    });

    it('says the date the undo stops working, and says nothing when there is none', async () => {
        // A deadline, so the assertion is the date itself against a known
        // clock. "a string" would be satisfied by the wrong day, or by today.
        const withClock = await staged({ expiresAt: new Date('2026-09-17T23:30:00.000Z') });
        const r = await reportOver(fakeBucket(CSV))
            .build({ tenantId: TENANT, batchId: withClock, seatQuotaEnforced: false });
        expect(r.undoUntil).toBe('2026-09-17');

        const noClock = await staged();
        const none = await reportOver(fakeBucket(CSV))
            .build({ tenantId: TENANT, batchId: noClock, seatQuotaEnforced: false });
        expect(none.undoUntil).toBeNull();
    });
});
