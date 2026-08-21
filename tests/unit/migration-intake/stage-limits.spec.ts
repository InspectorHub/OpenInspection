/**
 * The row cap, and the two things it must do when it fires.
 *
 * Report the REAL count, because a file over the line is not a mistake to
 * correct blind — the operator needs to know whether they are over by three
 * rows or by three thousand, and the answer decides whether they trim it or
 * ask for it to be brought in for them.
 *
 * And refuse the whole run, while staging has written nothing. A cap that
 * truncates would import a prefix of somebody's contact list and report success.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Database as SqliteDatabase } from 'better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { asD1DrizzleReturn } from '../helpers/test-db';
import { withBatch } from '../helpers/d1-binding';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { MigrationStageService } from '../../../server/services/migration-intake/stage.service';

const TENANT = '11111111-1111-1111-1111-1111111111a1';
const USER = '22222222-2222-2222-2222-2222222222b2';
const TIGHT = { maxCsvBytes: 1_000_000, maxVendorExportBytes: 2_000_000, maxRows: 3 };

function contactsBundle(count: number) {
    const contacts = Array.from({ length: count }, (_, i) => ({
        name: `P${i}`, email: `p${i}@example.test`, type: 'client' as const,
    }));
    return {
        formatVersion: 1,
        manifest: {
            source: { vendor: 'csv_generic' },
            adapter: { name: 'csv-generic', version: '1' },
            counts: {
                template: { readFromSource: 0, emitted: 0, dropped: [] },
                contact: { readFromSource: count, emitted: count, dropped: [] },
                member: { readFromSource: 0, emitted: 0, dropped: [] },
            },
            warnings: [],
        },
        templates: [], contacts, members: [],
    };
}

describe('MigrationStageService row cap', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: SqliteDatabase;
    let svc: MigrationStageService;

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        sqlite = fix.sqlite;
        await setupSchema(sqlite);
        // The service batches its writes, and better-sqlite3 is the one Drizzle
        // driver with no `batch()` — see helpers/d1-binding.ts.
        vi.mocked(mockDrizzle).mockReturnValue(asD1DrizzleReturn(withBatch(db, sqlite)));
        await db.insert(schema.tenants).values({
            id: TENANT, slug: 'a', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        svc = new MigrationStageService({} as D1Database);
    });

    afterEach(() => {
        sqlite.close();
        vi.clearAllMocks();
    });

    it('accepts a run at exactly the cap', async () => {
        const result = await svc.stage({
            tenantId: TENANT, createdBy: USER, intent: 'contacts.import',
            bundle: contactsBundle(3), limits: TIGHT,
        });
        expect(result.rows).toHaveLength(3);
        const rows = await db.select().from(schema.migrationRows)
            .where(eq(schema.migrationRows.batchId, result.batchId)).all();
        expect(rows).toHaveLength(3);
    });

    it('refuses one entry over, naming the real count and the cap', async () => {
        await expect(svc.stage({
            tenantId: TENANT, createdBy: USER, intent: 'contacts.import',
            bundle: contactsBundle(4), limits: TIGHT,
        })).rejects.toThrow(/4 entries and one import can carry 3/);
    });

    it('names the real count, not the cap plus one, when a file is far over', async () => {
        // The control for the message above: a refusal that reported "over the
        // limit" or echoed the cap back would satisfy a single boundary case.
        await expect(svc.stage({
            tenantId: TENANT, createdBy: USER, intent: 'contacts.import',
            bundle: contactsBundle(97), limits: TIGHT,
        })).rejects.toThrow(/97 entries and one import can carry 3/);
    });

    it('writes nothing at all when it refuses, and does write when it does not', async () => {
        await svc.stage({
            tenantId: TENANT, createdBy: USER, intent: 'contacts.import',
            bundle: contactsBundle(4), limits: TIGHT,
        }).catch(() => undefined);
        expect(await db.select().from(schema.migrationBatches).all()).toEqual([]);
        expect(await db.select().from(schema.migrationRows).all()).toEqual([]);

        // Positive control, in this same test: the two assertions above would
        // hold on a service that never wrote anything at all.
        await svc.stage({
            tenantId: TENANT, createdBy: USER, intent: 'contacts.import',
            bundle: contactsBundle(3), limits: TIGHT,
        });
        expect(await db.select().from(schema.migrationBatches).all()).toHaveLength(1);
        expect(await db.select().from(schema.migrationRows).all()).toHaveLength(3);
    });

    it('records the batch metadata the wizard needs to come back', async () => {
        const expiresAt = new Date('2026-09-17T00:00:00.000Z');
        const result = await svc.stage({
            tenantId: TENANT, createdBy: USER, intent: 'contacts.import',
            bundle: contactsBundle(1), limits: TIGHT,
            sourceKey: `${TENANT}/migrations/z/source.csv`,
            expiresAt,
            uploadAuthorizedBy: USER,
        });
        const batch = await db.select().from(schema.migrationBatches)
            .where(eq(schema.migrationBatches.id, result.batchId)).get();
        expect(batch?.sourceKey).toBe(`${TENANT}/migrations/z/source.csv`);
        expect(batch?.expiresAt?.getTime()).toBe(expiresAt.getTime());
        expect(batch?.uploadAuthorizedBy).toBe(USER);
        expect(batch?.uploadAuthorizedAt).toBeInstanceOf(Date);
        expect(batch?.uploadAuthorizationVersion).toBe('1');
        expect(batch?.staffAccessAuthorizedBy).toBeNull();
    });

    it('leaves every one of those columns null when the caller supplies none', async () => {
        // The control for the test above: each of those assertions would also
        // pass against a service that wrote a constant, so the unsupplied case
        // has to be checked from the other side.
        const result = await svc.stage({
            tenantId: TENANT, createdBy: USER, intent: 'contacts.import',
            bundle: contactsBundle(1), limits: TIGHT,
        });
        const batch = await db.select().from(schema.migrationBatches)
            .where(eq(schema.migrationBatches.id, result.batchId)).get();
        expect(batch?.sourceKey).toBeNull();
        expect(batch?.expiresAt).toBeNull();
        expect(batch?.uploadAuthorizedBy).toBeNull();
        expect(batch?.uploadAuthorizedAt).toBeNull();
        expect(batch?.uploadAuthorizationVersion).toBeNull();
        expect(batch?.staffAccessAuthorizedBy).toBeNull();
    });
});
