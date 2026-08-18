/**
 * Staging tables — shape, defaults and enum wiring.
 *
 * The two tables are the durable record of an intake run, so this spec pins
 * the things a later reader would otherwise have to infer from a migration
 * file: what a freshly staged row looks like, and that the status columns
 * default to the value the stage step actually writes.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

const TENANT = '11111111-1111-1111-1111-1111111111a1';
const BATCH = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1';
const ROW = 'cccccccc-cccc-cccc-cccc-ccccccccccc1';

describe('migration staging tables', () => {
    let db: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        await setupSchema(fix.sqlite);
    });

    it('defaults a new batch to staged with no policy and no timestamps', async () => {
        await db.insert(schema.migrationBatches).values({
            id: BATCH,
            tenantId: TENANT,
            createdBy: 'u1',
            intent: 'contacts.import',
            vendor: 'csv_generic',
            adapterName: 'csv-generic',
            adapterVersion: '1',
            manifest: '{"warnings":[]}',
            createdAt: new Date(),
        });
        const row = await db.select().from(schema.migrationBatches)
            .where(eq(schema.migrationBatches.id, BATCH)).get();
        expect(row?.status).toBe('staged');
        expect(row?.conflictPolicy).toBeNull();
        expect(row?.targetId).toBeNull();
        expect(row?.appliedAt).toBeNull();
        expect(row?.revertedAt).toBeNull();
    });

    it('defaults a new row to pending with every outcome column empty', async () => {
        await db.insert(schema.migrationBatches).values({
            id: BATCH,
            tenantId: TENANT,
            createdBy: 'u1',
            intent: 'contacts.import',
            vendor: 'csv_generic',
            adapterName: 'csv-generic',
            adapterVersion: '1',
            manifest: '{"warnings":[]}',
            createdAt: new Date(),
        });
        await db.insert(schema.migrationRows).values({
            id: ROW,
            batchId: BATCH,
            tenantId: TENANT,
            entity: 'contact',
            position: 0,
            payload: '{"name":"Alice","type":"client"}',
        });
        const row = await db.select().from(schema.migrationRows)
            .where(eq(schema.migrationRows.id, ROW)).get();
        expect(row?.status).toBe('pending');
        expect(row?.conflictWith).toBeNull();
        expect(row?.resolution).toBeNull();
        expect(row?.outcome).toBeNull();
        expect(row?.createdId).toBeNull();
        expect(row?.priorState).toBeNull();
        expect(row?.appliedAt).toBeNull();
    });

    it('exposes both status axes as frozen member lists', async () => {
        const { MIGRATION_BATCH_STATUSES } = await import('../../../server/lib/status/migration-batch-status');
        const { MIGRATION_ROW_STATUSES } = await import('../../../server/lib/status/migration-row-status');
        expect([...MIGRATION_BATCH_STATUSES]).toEqual([
            'staged', 'applying', 'applied', 'partially_applied',
            'reverted', 'partially_reverted', 'abandoned',
        ]);
        expect([...MIGRATION_ROW_STATUSES]).toEqual([
            'pending', 'applied', 'skipped', 'failed', 'reverted',
        ]);
    });
});
